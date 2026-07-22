import { z } from "zod";
import { tokenValid } from "@/server/security";
import { planOrchestration, type EngineOption } from "@/server/orchestrator";
import { listProviders } from "@/server/providers";
import { PROJECTS_ROOT } from "@/server/projects";
import { searchSkillsMarket, type SkillHit } from "@/server/marketplace";
import { MCP_PRESETS } from "@/server/mcp-store";

export const runtime = "nodejs";
export const maxDuration = 180;

const BodySchema = z.object({
  goal: z.string().min(1).max(4000),
  /** "Q: …\nA: …" pairs from the review step (refinement round). */
  answers: z.string().max(8000).optional(),
  /** Files the user attached in the modal (names + capped text excerpts). */
  references: z
    .array(z.object({ name: z.string().min(1).max(200), excerpt: z.string().max(4000).optional() }))
    .max(8)
    .optional(),
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

/** Turn the planner's marketplace keywords into real installable skills
 *  (best-effort: a marketplace hiccup must never sink the plan). */
async function findSuggestedSkills(queries: string[]): Promise<SkillHit[]> {
  const results = await Promise.all(
    queries.slice(0, 3).map((q) => searchSkillsMarket(q).catch(() => ({ ok: false as const }))),
  );
  const seen = new Set<string>();
  const out: SkillHit[] = [];
  for (const r of results) {
    if (!r.ok || !("skills" in r) || !r.skills) continue;
    for (const s of r.skills.slice(0, 2)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return out.slice(0, 4);
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
  const plan = await planOrchestration(body.goal, body.answers, engines, PROJECTS_ROOT, body.references);
  if (!plan.ok) return Response.json({ ok: false, error: plan.error ?? "Planning failed" });

  const suggestedSkills = plan.skillSearch?.length ? await findSuggestedSkills(plan.skillSearch) : [];
  // Only connectors we can actually offer: the local presets.
  const connectors = (plan.connectors ?? [])
    .map((c) => {
      const preset = MCP_PRESETS.find((p) => p.id === c.name);
      return preset ? { name: c.name, reason: c.reason, requiresToken: !!preset.requiresToken } : null;
    })
    .filter((c): c is { name: string; reason: string; requiresToken: boolean } => c !== null);

  return Response.json({ ok: true, plan, engines, suggestedSkills, connectors });
}
