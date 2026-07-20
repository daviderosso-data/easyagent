import { z } from "zod";
import { toggleSkill, SKILL_NAME_RE } from "@/server/skills";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";

const Body = z.object({ cwd: z.string(), name: z.string().regex(SKILL_NAME_RE), enabled: z.boolean() });

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  const check = validateCwd(body.cwd);
  if (!check.ok) return Response.json({ ok: false }, { status: 400 });
  const res = toggleSkill(check.path!, body.name, body.enabled);
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
