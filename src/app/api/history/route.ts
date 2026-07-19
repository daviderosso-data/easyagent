import { listSavePoints } from "@/server/snapshots";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const cwd = new URL(req.url).searchParams.get("cwd");
  const check = validateCwd(cwd);
  if (!check.ok) return Response.json({ ok: false, points: [] }, { status: 400 });
  return Response.json(await listSavePoints(check.path!));
}
