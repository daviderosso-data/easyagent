// Grok Build engine: drives the official `grok` CLI in headless mode
// (`-p … --output-format streaming-json`) and maps its NDJSON events onto
// AgentEvents. Approvals are policy-only in headless mode, so the security
// config maps to --sandbox/--permission-mode flags up front (P6 scope; the
// interactive-approval path is `grok agent stdio` (ACP), a later phase).
//
// NOTE: the success-path event shapes follow the official docs (types
// text|thought|end|error) but could only be exercised unauthenticated so far
// — the mapper is deliberately tolerant. See docs/providers.md.

import { spawn } from "node:child_process";
import type { AgentEvent } from "@/lib/agent-events";
import type { SecurityConfig } from "@/lib/settings";
import { authError, engineUnavailable, genericError } from "@/server/i18n-server";
import type { EngineStatus, ProviderModel, TurnRequest } from "@/server/providers/types";
import { engineEnv, resolveBin, runQuick, streamLines } from "@/server/providers/cli-utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function resolveGrokBin(): string | null {
  return resolveBin([process.env.EASYAGENT_GROK_BIN ?? "", "grok"].filter(Boolean));
}

/** Map the app's security config to grok's headless policy flags. Headless
 *  grok cannot prompt, so confined profiles get the workspace sandbox with
 *  edits allowed — the agent must be able to modify project files; the
 *  kernel sandbox (not a prompt) is the guard. */
export function grokSafetyArgs(c: SecurityConfig): string[] {
  const args: string[] = [];
  if (c.sandbox) args.push("--sandbox", "workspace");
  args.push("--permission-mode", c.behavior === "open" ? "bypassPermissions" : "acceptEdits");
  return args;
}

/** Our effort scale → grok's --reasoning-effort (none|low|medium|high|xhigh). */
export function grokEffort(effort: string): string {
  return effort === "max" ? "xhigh" : effort;
}

interface MapCtx {
  turnId: string;
  msgId: string;
  fallbackSessionId: string;
  started: number;
}

/** Map one parsed NDJSON event to AgentEvents (pure — unit-tested). */
export function mapGrokEvent(ev: any, ctx: MapCtx): AgentEvent[] {
  const t = ev?.type;
  if (t === "text" && typeof ev.text === "string" && ev.text) {
    return [{ type: "text", id: ctx.msgId, text: ev.text }];
  }
  if (t === "thought") {
    const text = typeof ev.text === "string" ? ev.text : typeof ev.thought === "string" ? ev.thought : "";
    return text ? [{ type: "thinking", id: ctx.msgId, text }] : [];
  }
  if (t === "error") {
    return [{ type: "error", message: typeof ev.message === "string" ? ev.message : "Grok error" }];
  }
  if (t === "end") {
    const usage = ev.usage ?? null;
    return [
      {
        type: "done",
        sessionId: ev.sessionId ?? ev.session_id ?? ctx.fallbackSessionId,
        isError: false,
        subtype: typeof ev.stopReason === "string" ? ev.stopReason : "success",
        numTurns: typeof ev.num_turns === "number" ? ev.num_turns : 1,
        durationMs: Date.now() - ctx.started,
        totalCostUsd: typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : 0,
        usage,
      },
    ];
  }
  return []; // unknown event types (auto_compact_*, …) are non-fatal noise
}

export async function runGrokTurn(req: TurnRequest): Promise<void> {
  const { turnId, turn, prompt, cwd, sessionId, config, lang, model, effort, systemAppend, send } = req;
  const bin = resolveGrokBin();
  if (!bin) {
    send({ type: "error", message: engineUnavailable("Grok Build", lang) });
    return;
  }

  // Headless grok has no separate system-prompt *append* flag; fold the
  // orchestrator persona into the prompt instead of overriding the preset.
  const fullPrompt = systemAppend ? `[Role instructions]\n${systemAppend}\n\n${prompt}` : prompt;
  const args = [
    "-p",
    fullPrompt,
    "--output-format",
    "streaming-json",
    ...(model ? ["-m", model] : []),
    ...(effort ? ["--reasoning-effort", grokEffort(effort)] : []),
    ...(sessionId ? ["--resume", sessionId] : []),
    ...grokSafetyArgs(config),
  ];

  const ctx: MapCtx = { turnId, msgId: `gk_${turnId}`, fallbackSessionId: sessionId ?? "", started: Date.now() };
  let terminal = false;
  const emit = (e: AgentEvent) => {
    if (terminal) return;
    if (e.type === "done" || e.type === "error") terminal = true;
    send(e);
  };

  emit({
    type: "ready",
    turnId,
    sessionId: sessionId ?? "",
    model: model ?? "grok",
    tools: [],
    slashCommands: [],
    apiKeySource: "subscription",
  });

  const { aborted } = await streamLines({
    cmd: bin,
    args,
    cwd,
    env: engineEnv({ GROK_DISABLE_AUTOUPDATER: "1" }),
    signal: turn.abort.signal,
    onLine: (line) => {
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return; // non-JSON noise
      }
      for (const e of mapGrokEvent(ev, ctx)) {
        if (e.type === "error" && /not signed in|not authenticated/i.test(e.message)) {
          emit({ type: "error", message: authError(lang) });
        } else {
          emit(e);
        }
      }
    },
  });

  if (!terminal) {
    if (aborted) {
      send({ type: "done", sessionId: ctx.fallbackSessionId, isError: false, subtype: "aborted", numTurns: 0, durationMs: 0, totalCostUsd: 0, usage: null });
    } else {
      send({ type: "error", message: genericError(lang) });
    }
  }
}

/* ---- status / account ---- */

export async function grokStatus(): Promise<EngineStatus> {
  const bin = resolveGrokBin();
  if (!bin) return { installed: false, loggedIn: null };
  // `grok models` exits 0 and prints "You are not authenticated." when logged
  // out — the CLI has no dedicated status command.
  const r = await runQuick(bin, ["models"], 15000);
  const out = `${r.stdout}\n${r.stderr}`;
  return { installed: true, loggedIn: r.ok ? !/not authenticated/i.test(out) : false };
}

export async function grokModels(): Promise<ProviderModel[]> {
  const bin = resolveGrokBin();
  if (!bin) return [{ id: null, label: "Default" }];
  // `grok models` lists "  * <id>" lines (works even before login).
  const r = await runQuick(bin, ["models"], 10000);
  const ids = [...r.stdout.matchAll(/^\s*\*\s+(\S+)/gm)].map((m) => m[1]);
  return [{ id: null, label: "Default" }, ...[...new Set(ids)].map((id) => ({ id, label: id }))];
}

export function grokStartLogin(): void {
  const bin = resolveGrokBin();
  if (!bin) return;
  // Launches the browser OAuth flow detached; the caller polls status.
  const child = spawn(bin, ["login"], { env: engineEnv(), detached: true, stdio: "ignore" });
  child.unref();
}

export async function grokLogout(): Promise<void> {
  const bin = resolveGrokBin();
  if (bin) await runQuick(bin, ["logout"], 15000);
}

export async function grokAccountStatus() {
  const s = await grokStatus();
  return { loggedIn: !!s.loggedIn };
}

export async function grokWaitForLogin(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await grokAccountStatus();
    if (s.loggedIn) return s;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { loggedIn: false };
}
