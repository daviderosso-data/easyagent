import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentEvent } from "@/lib/agent-events";
import { runTurn } from "@/server/agent-runner";
import { genericError } from "@/server/i18n-server";
import { getProvider } from "@/server/providers";
import { sessionManager } from "@/server/session-manager";
import { tokenValid, validateCwd } from "@/server/security";
import { loadSettings } from "@/server/settings-store";
import { orchestrationGrants } from "@/server/orchestration-grants";
import { ORCHESTRATION_CONFIG } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800; // long-running agent turns (30 min)

// Matches MAX_PANELS so every open panel can run a turn; the subscription's
// own rate limits are the real throttle, and slots free on disconnect.
const MAX_CONCURRENT_TURNS = 10;

const BodySchema = z.object({
  prompt: z.string().min(1).max(100_000),
  cwd: z.string().min(1),
  sessionId: z.string().optional(),
  lang: z.enum(["en", "it"]).default("en"),
  provider: z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  systemAppend: z.string().max(20_000).optional(),
  orchestrationGrant: z.string().optional(),
});

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request) {
  if (!tokenValid(req)) return err(403, "Unauthorized session.");
  if (sessionManager.size() >= MAX_CONCURRENT_TURNS) {
    return err(429, "Too many requests in progress.");
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return err(400, "Invalid request.");
  }

  // Confine the working directory (defense-in-depth on top of the middleware).
  const cwdCheck = validateCwd(body.cwd);
  if (!cwdCheck.ok) return err(400, cwdCheck.error ?? "Invalid folder.");

  // Resolve the engine up front so an unknown id is a 400, not a dead stream.
  const provider = getProvider(body.provider);
  if (!provider) return err(400, "Unknown provider.");

  // Security config comes from the server-side settings — except orchestration
  // turns, which use the autonomous-but-safe config so the loop never stalls.
  // That downgrade is gated by a server-minted grant (scoped to the project
  // /api/orchestrate created), never by the request body alone.
  const settings = loadSettings();
  let config = settings.security;
  if (body.orchestrationGrant !== undefined) {
    if (!orchestrationGrants.validFor(body.orchestrationGrant, cwdCheck.path!)) {
      return err(403, "Invalid or expired orchestration grant.");
    }
    config = ORCHESTRATION_CONFIG;
  }

  const turnId = randomUUID();
  const encoder = new TextEncoder();

  // Reserve the concurrency slot atomically (no await between check and
  // insert). The stream's start() below runs synchronously at construction,
  // and runTurn always releases the slot in its finally.
  const turn = sessionManager.tryCreate(turnId, new AbortController(), MAX_CONCURRENT_TURNS);
  if (!turn) return err(429, "Too many requests in progress.");
  turn.cwd = cwdCheck.path!;

  // If the client goes away (tab closed, fetch aborted), abort the turn:
  // otherwise a turn parked on an approval would wait forever and keep its
  // concurrency slot until the server restarts.
  const onDisconnect = () => sessionManager.abort(turnId);
  req.signal.addEventListener("abort", onDisconnect);
  if (req.signal.aborted) onDisconnect();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await runTurn({
          turnId,
          turn,
          prompt: body.prompt,
          cwd: cwdCheck.path!,
          sessionId: body.sessionId,
          config,
          lang: body.lang,
          provider: provider.id,
          model: body.model ?? settings.model ?? undefined,
          effort: body.effort,
          systemAppend: body.systemAppend,
          send,
        });
      } catch (e) {
        // Setup failures (rule/sandbox building, etc.) surface as a normal
        // error event instead of a silently truncated stream.
        console.error("[chat/send] turn failed before completion:", e);
        send({ type: "error", message: genericError(body.lang) });
      } finally {
        req.signal.removeEventListener("abort", onDisconnect);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      sessionManager.abort(turnId);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-turn-id": turnId,
    },
  });
}
