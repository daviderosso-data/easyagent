import { listDir } from "@/server/fs-browse";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

export function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const dir = new URL(req.url).searchParams.get("dir");
  return Response.json(listDir(dir));
}
