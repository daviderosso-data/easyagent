import { searchFiles } from "@/server/fs-mutate";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

export function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const url = new URL(req.url);
  const root = url.searchParams.get("root");
  const q = url.searchParams.get("q");
  return Response.json(searchFiles(root, q));
}
