import { tokenValid } from "@/server/security";
import { withinProjectsRoot } from "@/server/projects";
import { defaultProvider } from "@/server/providers";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ sessions: [] }, { status: 403 });
  const dir = new URL(req.url).searchParams.get("dir") ?? "";
  if (!withinProjectsRoot(dir)) return Response.json({ sessions: [] });
  const history = defaultProvider().history;
  return Response.json({ sessions: history ? await history.listSessions(dir) : [] });
}
