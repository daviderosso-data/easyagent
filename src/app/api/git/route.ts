import { projectGitStatus } from "@/server/git-view";
import { projectRootFor } from "@/server/snapshots";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const check = validateCwd(new URL(req.url).searchParams.get("cwd"));
  const root = check.ok ? projectRootFor(check.path!) : null;
  if (!root) return Response.json({ ok: false, hasRepo: false, files: [] }, { status: 400 });
  return Response.json(await projectGitStatus(root));
}
