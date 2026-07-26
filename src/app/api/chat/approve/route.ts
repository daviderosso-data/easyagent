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
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized session." }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const turn = sessionManager.get(body.turnId);
  if (!turn) {
    return Response.json({ error: "Turn not found." }, { status: 404 });
  }

  const pending = turn.pendingApprovals.get(body.approvalId);
  if (!pending) {
    return Response.json({ error: "Approval request not found." }, { status: 404 });
  }
  const resolve = pending.resolve;
  turn.pendingApprovals.delete(body.approvalId);

  // P7.1 — the decision may come from a different client than the one holding
  // the SSE stream (the phone). Tell that stream so its modal goes away.
  turn.emit?.({ type: "approval_resolved", approvalId: body.approvalId, decision: body.decision });

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
    resolve({ allow: false, message: "The user declined this action." });
  }

  return Response.json({ ok: true });
}
