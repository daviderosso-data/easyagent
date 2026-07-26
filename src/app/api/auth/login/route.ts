// P7 — login: verify the app password, set the session cookie. Rate limited
// (5 free attempts, then a doubling cool-down) on top of the proxy's
// origin/CSRF checks and the per-process token.

import { z } from "zod";
import { tokenValid } from "@/server/security";
import { createSession, loginGate, noteLogin, sessionSetCookie, verifyPassword } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let password: string;
  try {
    password = z.object({ password: z.string().min(1).max(200) }).parse(await req.json()).password;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const gate = loginGate();
  if (!gate.ok) return Response.json({ ok: false, retryAfter: gate.retryAfter }, { status: 429 });

  const ok = verifyPassword(password);
  noteLogin(ok);
  if (!ok) return Response.json({ ok: false }, { status: 401 });
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionSetCookie(createSession()) } });
}
