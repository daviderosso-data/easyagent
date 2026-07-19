import { diffSavePoint } from "@/server/snapshots";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";

const HASH_RE = /^[0-9a-f]{7,40}$/;

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd");
  const hash = url.searchParams.get("hash") ?? "";
  const check = validateCwd(cwd);
  if (!check.ok || !HASH_RE.test(hash)) return Response.json({ ok: false, files: [] }, { status: 400 });
  return Response.json(await diffSavePoint(check.path!, hash));
}
