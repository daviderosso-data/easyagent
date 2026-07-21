// Codex CLI engine: drives `codex exec --json` (JSONL lifecycle events:
// thread.started / turn.* / item.*) and maps them onto AgentEvents. Headless
// approvals are policy-only (--ask-for-approval never), so the security
// config maps to a sandbox level up front. Auth is the ChatGPT login held by
// the official binary (~/.codex/auth.json); ambient API keys never reach the
// subprocess (engineEnv scrubs them), so subscription auth is structural.

import { spawn } from "node:child_process";
import type { AgentEvent } from "@/lib/agent-events";
import type { SecurityConfig } from "@/lib/settings";
import { authError, engineUnavailable, genericError } from "@/server/i18n-server";
import type { EngineStatus, ProviderModel, TurnRequest } from "@/server/providers/types";
import { engineEnv, resolveBin, runQuick, streamLines } from "@/server/providers/cli-utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The codex invocation: the installed binary, or npx as a fallback (slower
 *  first run, but works without a global install). */
export function codexCmd(): { cmd: string; pre: string[] } | null {
  const bin = resolveBin([process.env.EASYAGENT_CODEX_BIN ?? "", "codex"].filter(Boolean));
  if (bin) return { cmd: bin, pre: [] };
  const npx = resolveBin(["npx"]);
  return npx ? { cmd: npx, pre: ["--yes", "@openai/codex@latest"] } : null;
}

/** Map the app's security config to codex's sandbox levels. Headless codex
 *  cannot ask, so every confined profile gets workspace-write (the agent must
 *  be able to edit project files — the sandbox, not a prompt, is the guard);
 *  network inside the sandbox follows the profile's install/network policy.
 *  Expressed as `-c` config overrides, NOT the --sandbox flag: `exec resume`
 *  rejects the flag but honours the overrides (verified live on 0.144.6 —
 *  this is also what un-sticks sessions created read-only before this fix).
 *  No --ask-for-approval: `exec` rejects it, it never prompts by construction. */
export function codexSafetyArgs(c: SecurityConfig): string[] {
  if (!c.sandbox && c.behavior === "open") return ["-c", "sandbox_mode=danger-full-access"];
  const network = c.installNetwork === "normal" || c.installNetwork === "off";
  return ["-c", "sandbox_mode=workspace-write", ...(network ? ["-c", "sandbox_workspace_write.network_access=true"] : [])];
}

/** Build the `codex exec` argv. Verified against codex-cli 0.144.6:
 *  `exec resume` rejects --sandbox / --ask-for-approval / -m (exit 2) — a
 *  resumed thread keeps the settings it was created with — and flags must
 *  precede the positional session id. */
/** Our effort scale → codex's model_reasoning_effort (max folds into xhigh). */
export function codexEffort(effort: string): string {
  return effort === "max" ? "xhigh" : effort;
}

export function codexExecArgs(p: {
  sessionId?: string;
  model?: string;
  effort?: string;
  config: SecurityConfig;
  prompt: string;
}): string[] {
  const common = [
    "--json",
    "--skip-git-repo-check",
    ...(p.effort ? ["-c", `model_reasoning_effort=${codexEffort(p.effort)}`] : []),
    ...codexSafetyArgs(p.config),
  ];
  return p.sessionId
    ? ["exec", "resume", ...common, p.sessionId, p.prompt]
    : ["exec", ...common, ...(p.model ? ["-m", p.model] : []), p.prompt];
}

export interface CodexMapCtx {
  turnId: string;
  model: string;
  sessionId: string;
  started: number;
  /** item ids already announced via tool_use (item.started before item.completed). */
  startedItems: Set<string>;
  lastError: string;
}

function toolUse(id: string, name: string, input: Record<string, unknown>): AgentEvent {
  return { type: "tool_use", id, name, input };
}
function toolResult(toolUseId: string, content: string, isError: boolean): AgentEvent {
  return { type: "tool_result", toolUseId, content, isError };
}

/** Which tool call (if any) an item describes — used for both started and
 *  completed phases so the transcript shows running tools live. */
function itemAsTool(item: any): { name: string; input: Record<string, unknown> } | null {
  switch (item?.type) {
    case "command_execution":
      return { name: "Bash", input: { command: item.command ?? "" } };
    case "file_change":
      return { name: "Edit", input: { changes: item.changes ?? item.path ?? "" } };
    case "web_search":
      return { name: "WebSearch", input: { query: item.query ?? "" } };
    case "mcp_tool_call":
      return { name: [item.server, item.tool].filter(Boolean).join(".") || "MCP", input: item.arguments ?? {} };
    default:
      return null;
  }
}

/** Map one parsed JSONL event to AgentEvents (pure — unit-tested). */
export function mapCodexEvent(ev: any, ctx: CodexMapCtx): AgentEvent[] {
  const t = ev?.type;
  if (t === "thread.started") {
    ctx.sessionId = ev.thread_id ?? ctx.sessionId;
    return [
      {
        type: "ready",
        turnId: ctx.turnId,
        sessionId: ctx.sessionId,
        model: ctx.model,
        tools: [],
        slashCommands: [],
        apiKeySource: "subscription",
      },
    ];
  }
  if (t === "item.started" || t === "item.updated") {
    const item = ev.item;
    const tool = itemAsTool(item);
    if (tool && item?.id && !ctx.startedItems.has(item.id)) {
      ctx.startedItems.add(item.id);
      return [toolUse(item.id, tool.name, tool.input)];
    }
    return [];
  }
  if (t === "item.completed") {
    const item = ev.item;
    if (!item) return [];
    if (item.type === "agent_message") {
      const text = item.text ?? "";
      return text ? [{ type: "text", id: item.id ?? `cx_${ctx.turnId}`, text }] : [];
    }
    if (item.type === "reasoning") {
      const text = item.text ?? "";
      return text ? [{ type: "thinking", id: item.id ?? `cxr_${ctx.turnId}`, text }] : [];
    }
    const tool = itemAsTool(item);
    if (tool) {
      const events: AgentEvent[] = [];
      if (item.id && !ctx.startedItems.has(item.id)) {
        ctx.startedItems.add(item.id);
        events.push(toolUse(item.id, tool.name, tool.input));
      }
      const output =
        typeof item.aggregated_output === "string"
          ? item.aggregated_output
          : typeof item.output === "string"
            ? item.output
            : "";
      const failed = item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0);
      events.push(toolResult(item.id ?? "", output, failed));
      return events;
    }
    return []; // todo_list & friends: internal bookkeeping
  }
  if (t === "turn.completed") {
    const u = ev.usage ?? {};
    return [
      {
        type: "done",
        sessionId: ctx.sessionId,
        isError: false,
        subtype: "success",
        numTurns: 1,
        durationMs: Date.now() - ctx.started,
        totalCostUsd: 0, // subscription — the plan pool is the meter
        usage: {
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
          cache_read_input_tokens: u.cached_input_tokens ?? 0,
        },
      },
    ];
  }
  if (t === "turn.failed") {
    return [{ type: "error", message: ev.error?.message ?? ctx.lastError ?? "Codex turn failed" }];
  }
  if (t === "error") {
    // Codex retries transient errors itself; remember the message but let the
    // terminal turn.failed (or stream end) decide.
    if (typeof ev.message === "string") ctx.lastError = ev.message;
    return [];
  }
  return [];
}

export async function runCodexTurn(req: TurnRequest): Promise<void> {
  const { turnId, turn, prompt, cwd, sessionId, config, lang, model, systemAppend, send } = req;
  const invocation = codexCmd();
  if (!invocation) {
    send({ type: "error", message: engineUnavailable("Codex CLI", lang) });
    return;
  }

  const fullPrompt = systemAppend ? `[Role instructions]\n${systemAppend}\n\n${prompt}` : prompt;
  const args = [...invocation.pre, ...codexExecArgs({ sessionId, model, effort: req.effort, config, prompt: fullPrompt })];

  const ctx: CodexMapCtx = {
    turnId,
    model: model ?? "codex",
    sessionId: sessionId ?? "",
    started: Date.now(),
    startedItems: new Set(),
    lastError: "",
  };
  let terminal = false;
  const emit = (e: AgentEvent) => {
    if (terminal) return;
    if (e.type === "done" || e.type === "error") terminal = true;
    send(e);
  };

  const { aborted } = await streamLines({
    cmd: invocation.cmd,
    args,
    cwd,
    env: engineEnv(),
    signal: turn.abort.signal,
    onLine: (line) => {
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      for (const e of mapCodexEvent(ev, ctx)) {
        if (e.type === "error" && /401|unauthorized|not logged in|login/i.test(e.message)) {
          emit({ type: "error", message: authError(lang) });
        } else {
          emit(e);
        }
      }
    },
  });

  if (!terminal) {
    if (aborted) {
      send({ type: "done", sessionId: ctx.sessionId, isError: false, subtype: "aborted", numTurns: 0, durationMs: 0, totalCostUsd: 0, usage: null });
    } else if (/401|unauthorized|not logged in/i.test(ctx.lastError)) {
      send({ type: "error", message: authError(lang) });
    } else {
      send({ type: "error", message: genericError(lang) });
    }
  }
}

/* ---- status / account ---- */

export async function codexStatus(): Promise<EngineStatus> {
  const invocation = codexCmd();
  if (!invocation) return { installed: false, loggedIn: null };
  const r = await runQuick(invocation.cmd, [...invocation.pre, "login", "status"], 20000);
  const out = `${r.stdout}\n${r.stderr}`;
  return { installed: true, loggedIn: r.ok && /logged in/i.test(out) };
}

export async function codexModels(): Promise<ProviderModel[]> {
  // No list command exists; these ids were verified live against a ChatGPT
  // account (2026-07-21): unknown ids fail the turn with a 400.
  return [
    { id: null, label: "Default" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4" },
  ];
}

export async function codexAccountStatus() {
  const s = await codexStatus();
  return { loggedIn: !!s.loggedIn };
}

export function codexStartLogin(): void {
  const invocation = codexCmd();
  if (!invocation) return;
  const child = spawn(invocation.cmd, [...invocation.pre, "login"], {
    env: engineEnv(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function codexLogout(): Promise<void> {
  const invocation = codexCmd();
  if (invocation) await runQuick(invocation.cmd, [...invocation.pre, "logout"], 15000);
}

export async function codexWaitForLogin(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await codexAccountStatus();
    if (s.loggedIn) return s;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { loggedIn: false };
}
