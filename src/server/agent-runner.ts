// Provider-neutral turn pipeline. Resolves the engine, takes the automatic
// save point, wraps send() with the usage recorder, and guarantees the
// concurrency slot is released — providers only stream AgentEvents.

import { basename } from "node:path";
import type { AgentEvent } from "@/lib/agent-events";
import { genericError } from "@/server/i18n-server";
import { getProvider } from "@/server/providers";
import type { TurnRequest } from "@/server/providers/types";
import { sessionManager } from "@/server/session-manager";
import { snapshotBeforeTurn } from "@/server/snapshots";
import { recordUsage, type UsageEvent } from "@/server/usage-store";

export interface RunParams extends Omit<TurnRequest, "send"> {
  /** Engine id from the request; undefined → default provider. The route
   *  validates it, so an unknown id here only happens on programmer error. */
  provider?: string;
  send: (e: AgentEvent) => void;
}

/** Turn context the recorder can't learn from events alone. */
export interface TurnUsageContext {
  provider: string;
  project: string;
  model?: string;
  sessionId?: string;
  effort?: string;
}

/** Wraps send() to record one usage event per turn from the event stream:
 *  `ready` refines model/session, the first `done` or `error` is recorded.
 *  Providers stay analytics-free — every engine gets identical accounting.
 *  Exported for tests; `record` is injectable so tests don't touch the store. */
export function recordingSend(
  base: (e: AgentEvent) => void,
  ctx: TurnUsageContext,
  record: (e: UsageEvent) => void = recordUsage,
): (e: AgentEvent) => void {
  let model = ctx.model ?? "";
  let sessionId = ctx.sessionId ?? "";
  let recorded = false;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  return (e) => {
    if (e.type === "ready") {
      model = e.model || model;
      sessionId = e.sessionId || sessionId;
    } else if ((e.type === "done" || e.type === "error") && !recorded) {
      recorded = true;
      const done = e.type === "done" ? e : null;
      if (done) sessionId = done.sessionId || sessionId;
      const u = (done?.usage ?? {}) as Record<string, unknown>;
      record({
        v: 2,
        ts: Date.now(),
        costUsd: done?.totalCostUsd ?? 0,
        inTok: num(u.input_tokens),
        outTok: num(u.output_tokens),
        cacheTok: num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
        model,
        provider: ctx.provider,
        project: ctx.project,
        sessionId,
        effort: ctx.effort,
        durationMs: done?.durationMs ?? 0,
        numTurns: done?.numTurns ?? 0,
        status: !done ? "error" : done.subtype === "aborted" ? "aborted" : done.isError ? "error" : "ok",
        subtype: done ? done.subtype : "error",
      });
    }
    base(e);
  };
}

/** Run one agent turn. The turn's concurrency slot was reserved by the route;
 *  this pipeline guarantees it is released no matter where the body throws
 *  (including provider resolution, before the engine even starts). */
export async function runTurn(params: RunParams): Promise<void> {
  const { provider: providerId, send, ...req } = params;
  try {
    const provider = getProvider(providerId);
    if (!provider) {
      send({ type: "error", message: genericError(req.lang) });
      return;
    }

    // Automatic save point before the agent touches anything. Internally
    // guarded (skips when git is missing or nothing changed) and never throws.
    await snapshotBeforeTurn(req.cwd, req.prompt, req.turnId);

    const turnReq: TurnRequest = {
      ...req,
      send: recordingSend(send, {
        provider: provider.id,
        project: basename(req.cwd),
        model: req.model,
        sessionId: req.sessionId,
        effort: req.effort,
      }),
    };
    await provider.runTurn(turnReq);
  } finally {
    sessionManager.end(params.turnId);
  }
}
