// P7 — logout: revoke this session and clear the cookie.

import { tokenValid } from "@/server/security";
import { readSessionId, revokeSession, sessionClearCookie } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  revokeSession(readSessionId(req));
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionClearCookie() } });
}
