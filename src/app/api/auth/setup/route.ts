// P7 — first-run setup: create the app password, or record "skip" so the
// welcome screen shows only once. Refused once a password exists.

import { z } from "zod";
import { tokenValid } from "@/server/security";
import { authState, createSession, sessionSetCookie, setupPassword, skipSetup, MIN_PASSWORD } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: { password?: string; skip?: boolean };
  try {
    body = z
      .object({ password: z.string().min(MIN_PASSWORD).max(200).optional(), skip: z.boolean().optional() })
      .parse(await req.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (authState().configured) return Response.json({ ok: false }, { status: 409 });

  if (body.skip) {
    skipSetup();
    return Response.json({ ok: true });
  }
  if (!body.password || !setupPassword(body.password)) return Response.json({ ok: false }, { status: 400 });
  // Log the creator straight in.
  return Response.json({ ok: true }, { headers: { "set-cookie": sessionSetCookie(createSession()) } });
}
