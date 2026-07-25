import { createAbCopy } from "@/server/ab-copy";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Creates the working copy for variant B of an A/B comparison. */
export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: { cwd?: unknown; provider?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const check = validateCwd(body.cwd);
  if (!check.ok || !check.path) return Response.json({ ok: false }, { status: 400 });
  return Response.json(createAbCopy(check.path, typeof body.provider === "string" ? body.provider : "b"));
}
