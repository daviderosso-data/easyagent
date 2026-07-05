import { z } from "zod";
import { sessionManager } from "@/server/session-manager";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

const BodySchema = z.object({
  turnId: z.string(),
  approvalId: z.string(),
  decision: z.enum(["allow", "deny"]),
  alwaysAllow: z.boolean().optional(),
});

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Non autorizzato" }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  const turn = sessionManager.get(body.turnId);
  if (!turn) {
    return Response.json({ error: "Turno non trovato" }, { status: 404 });
  }

  const resolve = turn.pendingApprovals.get(body.approvalId);
  if (!resolve) {
    return Response.json({ error: "Richiesta di approvazione non trovata" }, { status: 404 });
  }
  turn.pendingApprovals.delete(body.approvalId);

  if (body.decision === "allow") {
    // "Always allow here" → stop asking for edits for the rest of this turn.
    if (body.alwaysAllow && turn.query?.setPermissionMode) {
      try {
        await turn.query.setPermissionMode("acceptEdits");
      } catch {
        /* best effort */
      }
    }
    resolve({ allow: true });
  } else {
    resolve({ allow: false, message: "L'utente ha rifiutato questa azione." });
  }

  return Response.json({ ok: true });
}
