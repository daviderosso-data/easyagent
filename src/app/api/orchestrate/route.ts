import { join } from "node:path";
import { z } from "zod";
import { tokenValid } from "@/server/security";
import { createProject, createProjectFolder, writeProjectFile } from "@/server/projects";
import { markOrchestrated } from "@/server/project-registry";
import { orchestrationGrants } from "@/server/orchestration-grants";
import { getProvider } from "@/server/providers";
import { consumeStaging } from "@/server/fs-upload";
import { installSkillFromMarket } from "@/server/marketplace";

export const runtime = "nodejs";
export const maxDuration = 240; // skill installs clone their source repos

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
    /** Staged uploads from the modal, moved into <project>/reference/. */
    stagingId: z
      .string()
      .regex(/^[a-f0-9]{16,64}$/)
      .optional(),
    /** Marketplace skills the user kept checked in the plan review. */
    installSkills: z
      .array(z.object({ source: z.string().min(3).max(180), skillId: z.string().min(1).max(64) }))
      .max(4)
      .optional(),
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

  // Attached reference files: move them out of staging into the project so
  // every role can read them. A shared note goes into the brief.
  let referenceFiles: string[] = [];
  if (plan.stagingId) referenceFiles = consumeStaging(plan.stagingId, proj.path).files;
  const brief = referenceFiles.length
    ? `${plan.brief}\n\nReference files provided by the user are in the "reference/" folder at the project root:\n` +
      referenceFiles.map((f) => `- ${f}`).join("\n") +
      `\nRead the ones relevant to your role and follow them.`
    : plan.brief;

  // Install the marketplace skills the user kept selected (best-effort — a
  // failed install must not sink the launch).
  const installedSkills: { skillId: string; ok: boolean }[] = await Promise.all(
    (plan.installSkills ?? []).map(async (s) => {
      try {
        const r = await installSkillFromMarket(proj.path!, s.source, s.skillId);
        return { skillId: s.skillId, ok: !!r.ok };
      } catch {
        return { skillId: s.skillId, ok: false };
      }
    }),
  );

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
    brief,
    "",
    "## Roles",
    "",
    ...roles.map((r) => `- **${r.role}** (\`${r.folder.split("/").pop()}\`, ${r.provider ?? "claude"}${r.model ? ` / ${r.model}` : ""}): ${r.task}`),
    "",
    ...(installedSkills.some((s) => s.ok)
      ? ["## Skills", "", ...installedSkills.filter((s) => s.ok).map((s) => `- ${s.skillId} (in .claude/skills/)`), ""]
      : []),
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
    brief,
    roles,
    referenceFiles,
    installedSkills,
    // Lets this orchestration's turns use the autonomous-but-safe config;
    // scoped to the project just created and time-limited.
    grant: orchestrationGrants.mint(proj.path),
  });
}
