import { join } from "node:path";
import { z } from "zod";
import { tokenValid } from "@/server/security";
import { createProject, createProjectFolder, writeProjectFile } from "@/server/projects";
import { markOrchestrated } from "@/server/project-registry";
import { orchestrationGrants } from "@/server/orchestration-grants";
import { getProvider } from "@/server/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

// Launch a REVIEWED plan (produced by /api/orchestrate/plan and confirmed by
// the user): create the project + role folders + plan files and mint the
// orchestration grant. No model call happens here.
const BodySchema = z.object({
  goal: z.string().min(1).max(4000),
  plan: z.object({
    projectName: z.string().min(1).max(120),
    brief: z.string().max(20_000),
    roles: z
      .array(
        z.object({
          role: z.string().min(1).max(80),
          folder: z.string().min(1).max(80),
          task: z.string().min(1).max(4000),
          provider: z.string().max(40).optional(),
          model: z.string().max(80).nullable().optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
});

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const plan = body.plan;
  // Engines were offered by /plan from the live registry, but re-validate:
  // an unknown provider must not reach the turn route.
  for (const r of plan.roles) {
    if (r.provider && !getProvider(r.provider)) {
      return Response.json({ ok: false, error: `Unknown engine "${r.provider}"` });
    }
  }

  // Every orchestration creates a brand-new project folder.
  const proj = createProject(plan.projectName);
  if (!proj.ok || !proj.path || !proj.name) return Response.json({ ok: false, error: "Could not create the project folder" });
  markOrchestrated(proj.name, plan.projectName);

  // One subfolder per role inside the new project.
  const roles = plan.roles.map((r) => {
    const mk = createProjectFolder(proj.path!, r.folder);
    return {
      role: r.role,
      folder: mk.ok && mk.path ? mk.path : proj.path!,
      task: r.task,
      provider: r.provider,
      model: r.model ?? null,
    };
  });

  const md = [
    `# ${proj.name} — orchestration plan`,
    "",
    `**Goal:** ${body.goal}`,
    "",
    "## Shared brief",
    "",
    plan.brief,
    "",
    "## Roles",
    "",
    ...roles.map((r) => `- **${r.role}** (\`${r.folder.split("/").pop()}\`, ${r.provider ?? "claude"}${r.model ? ` / ${r.model}` : ""}): ${r.task}`),
    "",
    "## Status",
    "",
    "_Agents append their DONE summaries below._",
    "",
  ].join("\n");
  writeProjectFile(join(proj.path, "easyagent-plan.md"), md);
  writeProjectFile(join(proj.path, "easyagent-status.md"), `# ${proj.name} — status\n\n`);

  return Response.json({
    ok: true,
    projectRoot: proj.path,
    projectName: proj.name,
    brief: plan.brief,
    roles,
    // Lets this orchestration's turns use the autonomous-but-safe config;
    // scoped to the project just created and time-limited.
    grant: orchestrationGrants.mint(proj.path),
  });
}
