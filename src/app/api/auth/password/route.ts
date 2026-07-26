// P7 — change or remove the app password. Requires the current password AND
// an authenticated session; every other session is revoked on success.

import { z } from "zod";
import { tokenValid } from "@/server/security";
import {
  changePassword,
  createSession,
  readSessionId,
  removePassword,
  sessionClearCookie,
  sessionSetCookie,
  sessionValid,
  MIN_PASSWORD,
} from "@/server/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  if (!sessionValid(readSessionId(req))) return Response.json({ ok: false }, { status: 401 });
  let body: { current: string; next?: string | null };
  try {
    body = z
      .object({ current: z.string().min(1).max(200), next: z.string().min(MIN_PASSWORD).max(200).nullable().optional() })
      .parse(await req.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  if (body.next) {
    if (!changePassword(body.current, body.next)) return Response.json({ ok: false }, { status: 401 });
    // changePassword revoked everything — keep the caller signed in.
    return Response.json({ ok: true }, { headers: { "set-cookie": sessionSetCookie(createSession()) } });
  }
  if (!removePassword(body.current)) return Response.json({ ok: false }, { status: 401 });
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionClearCookie() } });
}
