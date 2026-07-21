import { z } from "zod";
import { installSkillFromMarket } from "@/server/marketplace";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 240; // the installer clones the source repo

const BodySchema = z.object({
  cwd: z.string().min(1),
  source: z.string().min(3).max(180),
  skillId: z.string().min(1).max(64),
});

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  const check = validateCwd(body.cwd);
  if (!check.ok) return Response.json({ ok: false, error: "bad-project" }, { status: 400 });
  return Response.json(await installSkillFromMarket(check.path!, body.source, body.skillId));
}
