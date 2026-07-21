import { z } from "zod";
import { tokenValid } from "@/server/security";
import { planOrchestration, type EngineOption } from "@/server/orchestrator";
import { listProviders } from "@/server/providers";
import { PROJECTS_ROOT } from "@/server/projects";

export const runtime = "nodejs";
export const maxDuration = 180;

const BodySchema = z.object({
  goal: z.string().min(1).max(4000),
  /** "Q: …\nA: …" pairs from the review step (refinement round). */
  answers: z.string().max(8000).optional(),
});

/** Engines the planner may assign: installed and (where applicable) signed in. */
async function usableEngines(): Promise<EngineOption[]> {
  const all = await Promise.all(
    listProviders().map(async (p) => ({
      p,
      status: await p.status(),
      models: await p.models(),
    })),
  );
  return all
    .filter(({ status }) => status.installed && status.loggedIn !== false)
    .map(({ p, models }) => ({
      id: p.id,
      label: p.label,
      models: models.map((m) => m.id),
      local: p.id === "ollama",
    }));
}

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const engines = await usableEngines();
  if (!engines.length) return Response.json({ ok: false, error: "No engine available" });
  const plan = await planOrchestration(body.goal, body.answers, engines, PROJECTS_ROOT);
  if (!plan.ok) return Response.json({ ok: false, error: plan.error ?? "Planning failed" });
  return Response.json({ ok: true, plan, engines });
}
