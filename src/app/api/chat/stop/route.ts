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
  if (!sessionManager.get(turnId)) return Response.json({ ok: true, note: "already ended" });

  sessionManager.abort(turnId);
  return Response.json({ ok: true });
}
