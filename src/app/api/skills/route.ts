import { installPresetSkill, listProjectSkills, presetSkillIds } from "@/server/skills";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";

export function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const check = validateCwd(new URL(req.url).searchParams.get("cwd"));
  const res = check.ok ? listProjectSkills(check.path!) : null;
  if (!res) return Response.json({ ok: false, skills: [] }, { status: 400 });
  return Response.json({ ok: true, ...res, presets: presetSkillIds(check.path!) });
}

/** P6.9.9 — one-click install of a built-in preset skill. */
export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: { cwd?: unknown; preset?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const check = validateCwd(body.cwd);
  if (!check.ok || typeof body.preset !== "string") return Response.json({ ok: false }, { status: 400 });
  return Response.json(installPresetSkill(check.path!, body.preset));
}
