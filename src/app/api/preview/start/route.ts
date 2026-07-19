import { z } from "zod";
import { previewManager } from "@/server/preview-manager";
import { projectRootFor } from "@/server/snapshots";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";

const Body = z.object({ cwd: z.string() });

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const check = validateCwd(body.cwd);
  const root = check.ok ? projectRootFor(check.path!) : null;
  if (!root) return Response.json({ state: "idle" }, { status: 400 });
  return Response.json(await previewManager.start(root));
}
