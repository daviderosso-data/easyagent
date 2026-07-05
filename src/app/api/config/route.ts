import { loadSettings } from "@/server/settings-store";
import { ensureProjectsRoot, PROJECTS_ROOT } from "@/server/projects";
import { validateCwd } from "@/server/security";

export const runtime = "nodejs";

/** Ensures the projects root exists and reports the default working directory
 *  (last-used folder if it still exists inside the root, else the root itself). */
export function GET() {
  ensureProjectsRoot();
  const settings = loadSettings();
  const check = settings.cwd ? validateCwd(settings.cwd) : { ok: false as const };
  const defaultCwd = check.ok && check.path ? check.path : PROJECTS_ROOT;
  return Response.json({
    defaultCwd,
    projectsRoot: PROJECTS_ROOT,
    sandboxSupported: process.platform !== "win32",
  });
}
