import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentEvent } from "@/lib/agent-events";
import { runTurn } from "@/server/agent-runner";
import { sessionManager } from "@/server/session-manager";
import { tokenValid, validateCwd } from "@/server/security";
import { loadSettings } from "@/server/settings-store";
import { ORCHESTRATION_CONFIG } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800; // long-running agent turns (30 min)

const MAX_CONCURRENT_TURNS = 4;

const BodySchema = z.object({
  prompt: z.string().min(1).max(100_000),
  cwd: z.string().min(1),
  sessionId: z.string().optional(),
  lang: z.enum(["en", "it"]).default("en"),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  systemAppend: z.string().max(20_000).optional(),
  orchestration: z.boolean().optional(),
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

  // Security config comes from the server-side settings — except orchestration
  // turns, which use the autonomous-but-safe config so the loop never stalls.
  const settings = loadSettings();
  const config = body.orchestration ? ORCHESTRATION_CONFIG : settings.security;

  const turnId = randomUUID();
  const encoder = new TextEncoder();

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
          prompt: body.prompt,
          cwd: cwdCheck.path!,
          sessionId: body.sessionId,
          config,
          lang: body.lang,
          model: body.model ?? settings.model ?? undefined,
          effort: body.effort,
          systemAppend: body.systemAppend,
          send,
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-turn-id": turnId,
    },
  });
}
