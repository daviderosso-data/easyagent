// Claude Code engine: drives the Claude Agent SDK and maps its message stream
// onto the provider-neutral AgentEvent protocol. Provider-neutral concerns
// (slot release, save-point snapshot, usage recording) live in the pipeline.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { behaviorToMode } from "@/server/safety-presets";
import { makeClassifier, buildRules } from "@/server/command-policy";
import { blockedReason, authError, genericError } from "@/server/i18n-server";
import { buildAgentEnv } from "@/server/security";
import { saveRateLimits } from "@/server/usage-store";
import { buildMcpConfig, recordMcpStatus } from "@/server/mcp-store";
import { skillsQueryOptions } from "@/server/skills";
import { autoAllows } from "@/server/safety-presets";
import type { TurnRequest } from "@/server/providers/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
        { path: "~/.kube", mode: "deny" },
        { path: "~/.docker", mode: "deny" },
        { path: "~/.netrc", mode: "deny" },
        { path: "~/.npmrc", mode: "deny" },
        { path: "~/.git-credentials", mode: "deny" },
        { path: "~/.pgpass", mode: "deny" },
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

export async function runClaudeTurn(params: TurnRequest): Promise<void> {
  const { turnId, turn, prompt, cwd, sessionId, config, lang, model, effort, systemAppend, send } = params;
  const abort = turn.abort;
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
    // Auto-allow when no confirmation is wanted (read-only tools, the "open"
    // profile). External MCP tools always prompt outside "open" — the
    // predicate is declarative and unit-tested in safety-presets.
    if (autoAllows(level, severity, toolName, config.behavior)) {
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
  // Id of the assistant message currently streaming (from message_start), so
  // partial text/thinking deltas accumulate under one item on the client.
  let streamMsgId = "";

  try {
    const q = query({
      prompt,
      options: {
        cwd,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        permissionMode,
        // The SDK requires this alongside bypassPermissions; without it the
        // "open" behavior fails instead of skipping prompts. The PreToolUse
        // hard gate still applies whenever the config enables blocks.
        ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
        ...(sessionId ? { resume: sessionId } : {}),
        ...(systemAppend
          ? { systemPrompt: { type: "preset", preset: "claude_code", append: systemAppend } }
          : {}),
        additionalDirectories: [],
        settingSources: [],
        settings: { permissions: { deny, ask }, disableSkillShellExecution: true },
        // Locked profile gets no external connections at all; strictMcpConfig
        // keeps ambient .mcp.json / settings servers out in every profile.
        mcpServers: config.profile === "locked" ? {} : buildMcpConfig(),
        strictMcpConfig: true,
        // Project skills load via a local plugin (see skills.ts probe notes).
        ...skillsQueryOptions(cwd),
        // Stream text/thinking as it is generated so long answers appear
        // incrementally instead of arriving all at once (looking like a hang).
        includePartialMessages: true,
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
        send({
          type: "ready",
          turnId,
          sessionId: m.session_id,
          model: m.model,
          tools: m.tools ?? [],
          slashCommands: m.slash_commands ?? [],
          apiKeySource: m.apiKeySource ?? "none",
          mcpServers: (m.mcp_servers ?? []).map((s: any) => ({ name: s.name, status: s.status })),
          skills: m.skills ?? [],
        });
        recordMcpStatus(m.mcp_servers ?? []);
        if ((m.mcp_servers ?? []).length > 0) {
          // Richer per-server status (errors, resolves "pending"); best effort.
          try {
            recordMcpStatus((await (q as any).mcpServerStatus?.()) ?? []);
          } catch {
            /* ignore */
          }
        }
        // Refresh subscription rate limits while the query is live.
        await captureRateLimits(q);
      } else if (m.type === "stream_event") {
        // Live token deltas for the top-level turn (sub-agent internals aren't
        // surfaced). Anthropic guarantees these deltas concatenate to the final
        // block text, so the completed assistant message below skips text to
        // avoid re-appending it.
        if (m.parent_tool_use_id == null) {
          const ev = m.event;
          if (ev?.type === "message_start") {
            streamMsgId = ev.message?.id ?? streamMsgId;
          } else if (ev?.type === "content_block_delta") {
            const d = ev.delta;
            if (d?.type === "text_delta" && d.text) send({ type: "text", id: streamMsgId, text: d.text });
            else if (d?.type === "thinking_delta" && d.thinking) send({ type: "thinking", id: streamMsgId, text: d.thinking });
          }
        }
      } else if (m.type === "assistant") {
        const streamed = m.parent_tool_use_id == null; // text/thinking already sent as deltas
        for (const block of m.message.content) {
          if (block.type === "tool_use") send({ type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} });
          else if (!streamed && block.type === "text" && block.text) send({ type: "text", id: m.message.id, text: block.text });
          else if (!streamed && block.type === "thinking" && block.thinking) send({ type: "thinking", id: m.message.id, text: block.thinking });
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
          console.error("[claude-runner] turn error:", msg);
          send({ type: "error", message: genericError(lang) });
        }
      }
    }
  }
}
