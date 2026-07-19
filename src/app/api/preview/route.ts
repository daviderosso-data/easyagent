import { previewManager } from "@/server/preview-manager";
import { projectRootFor } from "@/server/snapshots";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";

export function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const check = validateCwd(new URL(req.url).searchParams.get("cwd"));
  const root = check.ok ? projectRootFor(check.path!) : null;
  if (!root) return Response.json({ state: "idle" }, { status: 400 });
  return Response.json(previewManager.status(root));
}
