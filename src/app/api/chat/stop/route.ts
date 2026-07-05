import { z } from "zod";
import { sessionManager } from "@/server/session-manager";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

const BodySchema = z.object({ turnId: z.string() });

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Non autorizzato" }, { status: 403 });

  let turnId: string;
  try {
    turnId = BodySchema.parse(await req.json()).turnId;
  } catch {
    return Response.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  const turn = sessionManager.get(turnId);
  if (!turn) return Response.json({ ok: true, note: "già terminato" });

  try {
    turn.query?.interrupt?.();
  } catch {
    /* best effort */
  }
  turn.abort.abort();
  return Response.json({ ok: true });
}
