import { join } from "node:path";
import { z } from "zod";
import { tokenValid } from "@/server/security";
import { runOrchestrator } from "@/server/orchestrator";
import { createProject, createProjectFolder, writeProjectFile, PROJECTS_ROOT } from "@/server/projects";
import { markOrchestrated } from "@/server/project-registry";

export const runtime = "nodejs";
export const maxDuration = 180;

const BodySchema = z.object({
  goal: z.string().min(1).max(4000),
  lang: z.enum(["en", "it"]).default("en"),
});

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const plan = await runOrchestrator(body.goal, PROJECTS_ROOT);
  if (!plan.ok || !plan.roles) return Response.json({ ok: false, error: plan.error ?? "Planning failed" });

  // Every orchestration creates a brand-new project folder.
  const proj = createProject(plan.projectName ?? "project");
  if (!proj.ok || !proj.path || !proj.name) return Response.json({ ok: false, error: "Could not create the project folder" });
  markOrchestrated(proj.name, plan.projectName ?? proj.name);

  // One subfolder per role inside the new project.
  const roles = plan.roles.map((r) => {
    const mk = createProjectFolder(proj.path!, r.folder);
    return { role: r.role, folder: mk.ok && mk.path ? mk.path : proj.path!, task: r.task };
  });

  const md = [
    `# ${proj.name} — orchestration plan`,
    "",
    `**Goal:** ${body.goal}`,
    "",
    "## Shared brief",
    "",
    plan.brief ?? "",
    "",
    "## Roles",
    "",
    ...roles.map((r) => `- **${r.role}** (\`${r.folder.split("/").pop()}\`): ${r.task}`),
    "",
    "## Status",
    "",
    "_Agents append their DONE summaries below._",
    "",
  ].join("\n");
  writeProjectFile(join(proj.path, "easyclaude-plan.md"), md);
  writeProjectFile(join(proj.path, "easyclaude-status.md"), `# ${proj.name} — status\n\n`);

  return Response.json({
    ok: true,
    projectRoot: proj.path,
    projectName: proj.name,
    brief: plan.brief ?? "",
    roles,
  });
}
