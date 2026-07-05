import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@/lib/agent-events";
import type { SecurityConfig, Lang } from "@/lib/settings";
import { behaviorToMode, READ_ONLY_TOOLS } from "@/server/safety-presets";
import { makeClassifier, buildRules } from "@/server/command-policy";
import { blockedReason, authError, genericError } from "@/server/i18n-server";
import { buildAgentEnv } from "@/server/security";
import { sessionManager } from "@/server/session-manager";
import { recordUsage, saveRateLimits } from "@/server/usage-store";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RunParams {
  turnId: string;
  prompt: string;
  cwd: string;
  sessionId?: string;
  config: SecurityConfig;
  lang: Lang;
  model?: string;
  effort?: string;
  systemAppend?: string;
  send: (e: AgentEvent) => void;
}

/** OS sandbox: confines Bash writes to cwd and denies secret reads. macOS uses
 *  built-in Seatbelt; Windows unsupported → null (hook+deny+classifier still apply). */
export function buildSandboxConfig(): Record<string, unknown> | null {
  if (process.platform === "win32") return null;
  return {
    enabled: true,
    failIfUnavailable: false,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    credentials: {
      files: [
        { path: "~/.ssh", mode: "deny" },
        { path: "~/.aws", mode: "deny" },
        { path: "~/.gnupg", mode: "deny" },
        { path: "~/.config/gcloud", mode: "deny" },
        { path: "~/.claude/.credentials.json", mode: "deny" },
      ],
    },
  };
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b?.type === "text" ? b.text : typeof b === "string" ? b : JSON.stringify(b)))
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function recordTurnUsage(model: string, result: any): void {
  const u = result?.usage ?? {};
  recordUsage({
    ts: Date.now(),
    costUsd: result?.total_cost_usd ?? 0,
    inTok: u.input_tokens ?? 0,
    outTok: u.output_tokens ?? 0,
    cacheTok: (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    model,
  });
}

/** Capture subscription rate-limit utilization (experimental SDK API). MUST be
 *  called while the query is still live (right after init) — it fails once the
 *  query has closed after the result. */
export async function captureRateLimits(q: any): Promise<void> {
  try {
    const data = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    const rl = data?.rate_limits;
    saveRateLimits({
      subscriptionType: data?.subscription_type ?? null,
      fiveHour: rl?.five_hour
        ? { utilization: rl.five_hour.utilization ?? null, resetsAt: rl.five_hour.resets_at ?? null }
        : null,
      sevenDay: rl?.seven_day
        ? { utilization: rl.seven_day.utilization ?? null, resetsAt: rl.seven_day.resets_at ?? null }
        : null,
      capturedAt: Date.now(),
    });
  } catch {
    /* experimental API unavailable — self-tracked usage still recorded */
  }
}

export async function runTurn(params: RunParams): Promise<void> {
  const { turnId, prompt, cwd, sessionId, config, lang, model, effort, systemAppend, send } = params;
  const abort = new AbortController();
  const turn = sessionManager.create(turnId, abort);
  const classify = makeClassifier(cwd, config);
  const permissionMode = behaviorToMode(config.behavior);
  const { deny, ask } = buildRules(config);
  const sandbox = config.sandbox ? buildSandboxConfig() : null;

  // Hard gate: runs before everything, applies even under bypassPermissions.
  const preToolGate = async (input: any): Promise<any> => {
    const { level, severity } = classify(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
    if (level === "block") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: blockedReason(severity, lang),
        },
      };
    }
    if (level === "red") {
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: severity },
      };
    }
    return {};
  };

  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    opts: { title?: string },
  ): Promise<any> => {
    const { level, severity } = classify(toolName, input);
    if (level === "block") {
      return { behavior: "deny", message: blockedReason(severity, lang) };
    }
    // Auto-allow when no confirmation is wanted: read-only tools always, and
    // everything under the "open" profile (bypass still routes here because a
    // canUseTool callback is registered).
    if (level === "normal" && (config.behavior === "open" || READ_ONLY_TOOLS.has(toolName))) {
      return { behavior: "allow", updatedInput: input };
    }
    const approvalId = randomUUID();
    send({
      type: "approval_request",
      approvalId,
      turnId,
      toolName,
      input,
      title: opts.title ?? "",
      risk: level === "red" ? "red" : "normal",
      severity,
    });
    return new Promise((resolve) => {
      turn.pendingApprovals.set(approvalId, (decision) => {
        if (decision.allow) resolve({ behavior: "allow", updatedInput: input });
        else resolve({ behavior: "deny", message: decision.message ?? "Denied." });
      });
    });
  };

  let sawResult = false;
  let currentSessionId = sessionId ?? "";
  let activeModel = model ?? "";

  try {
    const q = query({
      prompt,
      options: {
        cwd,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        permissionMode,
        ...(sessionId ? { resume: sessionId } : {}),
        ...(systemAppend
          ? { systemPrompt: { type: "preset", preset: "claude_code", append: systemAppend } }
          : {}),
        additionalDirectories: [],
        settingSources: [],
        settings: { permissions: { deny, ask } },
        ...(sandbox ? { sandbox } : {}),
        hooks: { PreToolUse: [{ hooks: [preToolGate] }] },
        abortController: abort,
        canUseTool: canUseTool as any,
        env: buildAgentEnv(),
      } as any,
    });
    turn.query = q as any;

    for await (const m of q as AsyncIterable<any>) {
      if (m.type === "system" && m.subtype === "init") {
        currentSessionId = m.session_id;
        activeModel = m.model ?? activeModel;
        send({
          type: "ready",
          turnId,
          sessionId: m.session_id,
          model: m.model,
          tools: m.tools ?? [],
          slashCommands: m.slash_commands ?? [],
          apiKeySource: m.apiKeySource ?? "none",
        });
        // Refresh subscription rate limits while the query is live.
        await captureRateLimits(q);
      } else if (m.type === "assistant") {
        for (const block of m.message.content) {
          if (block.type === "text" && block.text) send({ type: "text", id: m.message.id, text: block.text });
          else if (block.type === "thinking" && block.thinking) send({ type: "thinking", id: m.message.id, text: block.thinking });
          else if (block.type === "tool_use") send({ type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} });
        }
      } else if (m.type === "user") {
        const content = m.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              send({
                type: "tool_result",
                toolUseId: block.tool_use_id,
                content: stringifyToolResult(block.content),
                isError: !!block.is_error,
              });
            }
          }
        }
      } else if (m.type === "result") {
        sawResult = true;
        currentSessionId = m.session_id ?? currentSessionId;
        recordTurnUsage(activeModel, m);
        send({
          type: "done",
          sessionId: currentSessionId,
          isError: !!m.is_error,
          subtype: m.subtype,
          numTurns: m.num_turns ?? 0,
          durationMs: m.duration_ms ?? 0,
          totalCostUsd: m.total_cost_usd ?? 0,
          usage: m.usage ?? null,
        });
      }
    }
  } catch (e) {
    if (!sawResult) {
      const aborted = abort.signal.aborted;
      const msg = e instanceof Error ? e.message : String(e);
      if (aborted) {
        send({ type: "done", sessionId: currentSessionId, isError: false, subtype: "aborted", numTurns: 0, durationMs: 0, totalCostUsd: 0, usage: null });
      } else {
        if (/api key|authentication|401|unauthorized|not logged in|not signed in/i.test(msg)) {
          send({ type: "error", message: authError(lang) });
        } else {
          console.error("[agent-runner] turn error:", msg);
          send({ type: "error", message: genericError(lang) });
        }
      }
    }
  } finally {
    sessionManager.end(turnId);
  }
}
