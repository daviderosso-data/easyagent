import { tokenValid } from "@/server/security";
import { withinProjectsRoot } from "@/server/projects";
import { listProjectSessions } from "@/server/sessions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ sessions: [] }, { status: 403 });
  const dir = new URL(req.url).searchParams.get("dir") ?? "";
  if (!withinProjectsRoot(dir)) return Response.json({ sessions: [] });
  return Response.json({ sessions: await listProjectSessions(dir) });
}
