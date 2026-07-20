import { listProjectSkills } from "@/server/skills";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";

export function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const check = validateCwd(new URL(req.url).searchParams.get("cwd"));
  const res = check.ok ? listProjectSkills(check.path!) : null;
  if (!res) return Response.json({ ok: false, skills: [] }, { status: 400 });
  return Response.json({ ok: true, ...res });
}
