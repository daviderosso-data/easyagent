// Copilot CLI engine: drives `copilot -p --output-format json` (JSONL events:
// assistant.*, tool.execution_*, result) and maps them onto AgentEvents.
// Auth is the user's GitHub login: a token minted from the local `gh` CLI when
// present (COPILOT_GITHUB_TOKEN — the documented headless method) or the
// credential stored by `copilot login` (macOS Keychain). Ambient tokens are
// scrubbed by engineEnv, so credentials only reach the subprocess explicitly.
// Verified live on 1.0.74/1.0.75 (2026-07-24) — see docs/providers.md.

import type { AgentEvent } from "@/lib/agent-events";
import type { SecurityConfig } from "@/lib/settings";
import { engineUnavailable, genericError, authError, rateLimitError, RATE_LIMIT_RE } from "@/server/i18n-server";
import type { EngineStatus, ProviderModel, TurnRequest } from "@/server/providers/types";
import { engineEnv, resolveBin, runQuick, streamLines } from "@/server/providers/cli-utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** npx fallback pinned to a live-verified version: the CLI's flag surface has
 *  broken downstream wrappers before (its own SDK included), and @latest moved
 *  twice in one day during the spike. Upgrades are deliberate. */
const PINNED = "@github/copilot@1.0.75";

export function copilotCmd(): { cmd: string; pre: string[] } | null {
  const bin = resolveBin([process.env.EASYAGENT_COPILOT_BIN ?? "", "copilot"].filter(Boolean));
  if (bin) return { cmd: bin, pre: [] };
  const npx = resolveBin(["npx"]);
  return npx ? { cmd: npx, pre: ["--yes", PINNED] } : null;
}

/* GitHub token minted from the user's gh login (cached — tokens rotate). */
const gt = globalThis as unknown as { __ccw_copilot_token?: { v: string | null; at: number } };

export async function copilotToken(): Promise<string | null> {
  const cached = gt.__ccw_copilot_token;
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.v;
  const gh = resolveBin(["gh"]);
  let v: string | null = null;
  if (gh) {
    const r = await runQuick(gh, ["auth", "token"], 10_000);
    v = r.ok && r.stdout.trim() ? r.stdout.trim().split("\n")[0] : null;
  }
  gt.__ccw_copilot_token = { v, at: Date.now() };
  return v;
}

async function copilotEnv(): Promise<NodeJS.ProcessEnv> {
  const token = await copilotToken();
  return engineEnv(token ? { COPILOT_GITHUB_TOKEN: token } : undefined);
}

/** Headless copilot cannot prompt: --allow-all-tools is mandatory for -p. The
 *  guards left standing are the CLI's own path verification (on unless
 *  --allow-all-paths, so writes stay near the project) and URL confirmation
 *  (unapproved fetches fail instead of asking). */
export function copilotSafetyArgs(c: SecurityConfig): string[] {
  if (!c.sandbox && c.behavior === "open") return ["--allow-all"];
  const urls = c.installNetwork === "normal" || c.installNetwork === "off";
  return ["--allow-all-tools", ...(urls ? ["--allow-all-urls"] : [])];
}

export interface MapCtx {
  turnId: string;
  fallbackSessionId: string;
  /** Chars already streamed per messageId so the final message isn't doubled. */
  streamed: Map<string, number>;
  lastError: string;
}

const MAX_TOOL_RESULT = 20_000;

export function mapCopilotEvent(ev: any, ctx: MapCtx): AgentEvent[] {
  const t = ev?.type;
  const d = ev?.data ?? {};
  if (t === "assistant.message_delta") {
    const id = String(d.messageId ?? "m");
    const text = typeof d.deltaContent === "string" ? d.deltaContent : "";
    if (!text) return [];
    ctx.streamed.set(id, (ctx.streamed.get(id) ?? 0) + text.length);
    return [{ type: "text", id, text }];
  }
  if (t === "assistant.message") {
    // Deltas usually cover the full content — emit only whatever is missing.
    const id = String(d.messageId ?? "m");
    const content = typeof d.content === "string" ? d.content : "";
    const rest = content.slice(ctx.streamed.get(id) ?? 0);
    ctx.streamed.set(id, content.length);
    return rest ? [{ type: "text", id, text: rest }] : [];
  }
  if (t === "tool.execution_start") {
    const input = d.arguments && typeof d.arguments === "object" ? (d.arguments as Record<string, unknown>) : {};
    return [{ type: "tool_use", id: String(d.toolCallId ?? ""), name: String(d.toolName ?? "tool"), input }];
  }
  if (t === "tool.execution_complete") {
    const r = d.result ?? {};
    const content = [r.content, r.detailedContent]
      .filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      .join("\n")
      .slice(0, MAX_TOOL_RESULT);
    return [{ type: "tool_result", toolUseId: String(d.toolCallId ?? ""), content, isError: d.success === false }];
  }
  if (t === "error" || t === "session.error") {
    const msg =
      typeof d.message === "string" ? d.message : typeof ev?.message === "string" ? ev.message : "Copilot error";
    ctx.lastError = msg;
    return [{ type: "error", message: msg }];
  }
  if (t === "result") {
    const usage = ev?.usage ?? {};
    return [
      {
        type: "done",
        sessionId: String(ev?.sessionId ?? ctx.fallbackSessionId ?? ""),
        isError: (ev?.exitCode ?? 0) !== 0,
        subtype: "success",
        numTurns: 1,
        durationMs: Number(usage.sessionDurationMs ?? 0),
        totalCostUsd: 0,
        usage: null,
      },
    ];
  }
  return []; // session.* / model.* / ephemeral chatter
}

export async function runCopilotTurn(req: TurnRequest): Promise<void> {
  const { turnId, turn, prompt, cwd, sessionId, config, lang, model, effort, systemAppend, send } = req;
  const invocation = copilotCmd();
  if (!invocation) {
    send({ type: "error", message: engineUnavailable("Copilot", lang) });
    return;
  }

  // No separate system-prompt append flag in -p mode; fold the persona in.
  const fullPrompt = systemAppend ? `[Role instructions]\n${systemAppend}\n\n${prompt}` : prompt;
  const args = [
    ...invocation.pre,
    "-p",
    fullPrompt,
    "--output-format",
    "json",
    "--no-remote", // never export the session to GitHub web/mobile
    "--no-auto-update",
    "--no-color",
    "--log-level",
    "none",
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
    ...(sessionId ? ["--resume", sessionId] : []),
    ...copilotSafetyArgs(config),
  ];

  const ctx: MapCtx = { turnId, fallbackSessionId: sessionId ?? "", streamed: new Map(), lastError: "" };
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
    model: model ?? "auto",
    tools: [],
    slashCommands: [],
    apiKeySource: "subscription",
  });

  const env = await copilotEnv();
  const { aborted } = await streamLines({
    cmd: invocation.cmd,
    args,
    cwd,
    env,
    signal: turn.abort.signal,
    onLine: (line) => {
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return; // non-JSON noise
      }
      for (const e of mapCopilotEvent(ev, ctx)) {
        if (e.type === "error" && /401|unauthorized|not (?:signed in|authenticated|logged in)/i.test(e.message)) {
          emit({ type: "error", message: authError(lang) });
        } else if (e.type === "error" && RATE_LIMIT_RE.test(e.message)) {
          emit({ type: "error", message: rateLimitError(lang), code: "rate-limit" });
        } else {
          emit(e);
        }
      }
    },
  });

  if (!terminal) {
    if (aborted) {
      send({ type: "done", sessionId: ctx.fallbackSessionId, isError: false, subtype: "aborted", numTurns: 0, durationMs: 0, totalCostUsd: 0, usage: null });
    } else if (RATE_LIMIT_RE.test(ctx.lastError)) {
      send({ type: "error", message: rateLimitError(lang), code: "rate-limit" });
    } else if (!env.COPILOT_GITHUB_TOKEN) {
      // Died silently with no gh token → almost certainly an auth problem.
      send({ type: "error", message: authError(lang) });
    } else {
      send({ type: "error", message: genericError(lang) });
    }
  }
}

/* ---- status / models ---- */

export async function copilotStatus(): Promise<EngineStatus> {
  const invocation = copilotCmd();
  if (!invocation) return { installed: false, loggedIn: null };
  // A gh-minted token is a sure yes; without gh we cannot cheaply probe the
  // credential store, so report unknown instead of lying.
  const token = await copilotToken();
  return { installed: true, loggedIn: token ? true : null };
}

function modelLabel(id: string): string {
  return id
    .split("-")
    .map((w) => (w === "gpt" ? "GPT" : /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// Live-verified subset (2026-07-24) used when `help config` can't be parsed.
const FALLBACK_MODELS = ["claude-sonnet-5", "claude-fable-5", "claude-opus-4.8", "claude-haiku-4.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

const gm = globalThis as unknown as { __ccw_copilot_models?: { at: number; list: ProviderModel[] } };

export async function copilotModels(): Promise<ProviderModel[]> {
  const cached = gm.__ccw_copilot_models;
  if (cached && Date.now() - cached.at < 60 * 60_000) return cached.list;
  // No models command exists; the authoritative list lives in `help config`.
  let ids: string[] = [];
  const invocation = copilotCmd();
  if (invocation) {
    const r = await runQuick(invocation.cmd, [...invocation.pre, "help", "config"], 30_000);
    if (r.ok) {
      const section = /`model`:[\s\S]*?(?=\n\s*`|$)/.exec(r.stdout)?.[0] ?? "";
      ids = [...section.matchAll(/- "([a-z0-9.-]+)"/g)].map((m) => m[1]);
    }
  }
  if (!ids.length) ids = FALLBACK_MODELS;
  const list: ProviderModel[] = [{ id: null, label: "Default" }, ...ids.map((id) => ({ id, label: modelLabel(id) }))];
  gm.__ccw_copilot_models = { at: Date.now(), list };
  return list;
}
