// P7.1 — read-only snapshot for the phone: live turns and every approval
// waiting for a human. Polled; the per-turn SSE stream belongs to the desktop
// that opened it and cannot be shared. Auth is enforced by the proxy.

import { sessionManager } from "@/server/session-manager";

export const runtime = "nodejs";

const basename = (p?: string) => (p ? p.split("/").filter(Boolean).pop() ?? "" : "");

export function GET() {
  const turns = sessionManager.listTurns().map((t) => ({
    turnId: t.turnId,
    name: t.roleLabel || basename(t.project ?? t.cwd),
    pending: t.pending,
  }));
  const approvals = sessionManager.listApprovals().map((a) => ({
    approvalId: a.approvalId,
    turnId: a.turnId,
    toolName: a.toolName,
    title: a.title,
    target: a.target,
    risk: a.risk,
    severity: a.severity,
    name: a.roleLabel || basename(a.project),
  }));
  return Response.json({ turns, approvals, at: Date.now() });
}
