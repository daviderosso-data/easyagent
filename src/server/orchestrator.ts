import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildAgentEnv } from "@/server/security";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PlannedRole {
  role: string;
  folder: string;
  task: string;
  /** Engine assigned to this role (validated against the available list). */
  provider: string;
  /** Model id within that engine (null = engine default). */
  model: string | null;
}

export interface OrchestratorPlan {
  ok: boolean;
  projectName?: string;
  brief?: string;
  /** Short, specific structure questions for the user to confirm before launch. */
  questions?: string[];
  roles?: PlannedRole[];
  /** Marketplace search keywords for skills that would help this project. */
  skillSearch?: string[];
  /** Recommended MCP connectors (validated against the preset ids upstream). */
  connectors?: { name: string; reason: string }[];
  error?: string;
}

/** A reference file the user attached in the modal (name + optional excerpt). */
export interface PlanReference {
  name: string;
  excerpt?: string;
}

/** One available engine as offered to the planner. */
export interface EngineOption {
  id: string;
  label: string;
  models: (string | null)[];
  local: boolean;
}

function engineCatalogue(engines: EngineOption[]): string {
  return engines
    .map(
      (e) =>
        `- provider "${e.id}" (${e.label}${e.local ? " — runs locally, free, weaker" : ""}): models ${e.models
          .map((m) => m ?? "default")
          .join(", ")}`,
    )
    .join("\n");
}

function referenceSection(references: PlanReference[] | undefined): string {
  if (!references?.length) return "";
  const lines = references
    .slice(0, 8)
    .map((r) => `- ${r.name}${r.excerpt ? `\n  Excerpt:\n  ${r.excerpt.slice(0, 3000).replace(/\n/g, "\n  ")}` : ""}`)
    .join("\n");
  return (
    `\nREFERENCE FILES the user attached. They will be available to every agent in the "reference/" folder at ` +
    `the project root — factor them into the brief and the role tasks, and tell the roles to read the relevant ones:\n${lines}\n`
  );
}

function planInstructions(engines: EngineOption[], references?: PlanReference[]): string {
  return `You are the ORCHESTRATOR of a new software project. The user gives a goal.
Design the project and split the work into 2 to 6 specialized roles that fit THIS goal (e.g. Backend,
Frontend, Database, Design, Copy, Tests/QA, Docs — whatever actually fits). Use the SMALLEST team that
genuinely covers the goal: prefer 2-3 roles for simple goals, and only go up to 5-6 when the goal has
clearly separable workstreams that can proceed in parallel. No filler roles. Choose a short PROJECT NAME
and a SHARED BRIEF: the common decisions every role MUST follow (tech stack, data/API contracts,
file/naming conventions, how pieces fit, visual/tone guidelines). For each role choose a short lowercase
folder name (letters/dashes) and a concrete, self-contained task.

ENGINES AND MODELS available on this machine (the ONLY ones you may assign):
${engineCatalogue(engines)}

Assign each role the LIGHTEST engine+model that is adequate for its difficulty — this saves tokens and keeps
the machine responsive. Reserve the most capable model for the single hardest role; simple self-contained
work (copy, static pages, config) suits smaller or local models. Use "default" (null model) unless a
specific model is clearly better.

Also write up to 4 SHORT, specific QUESTIONS about structural choices that are genuinely ambiguous in the
goal (stack, data shape, pages, integrations, target platform). No filler questions. If the goal is fully
clear, return an empty questions array.
${referenceSection(references)}
RECOMMENDATIONS. Also suggest, only when genuinely useful for THIS project (empty arrays are fine):
- "skillSearch": up to 3 short English search keywords (1-3 words each) for an agent-skill marketplace,
  naming capabilities that would concretely help the roles (e.g. "excel automation", "stripe payments").
- "connectors": up to 2 recommended connectors chosen ONLY from this list, each with a one-sentence reason:
  "chrome" (drive a real browser: live testing, scraping), "github" (work with GitHub repos/PRs/issues),
  "filesystem" (read/write files outside the project folder), "memory" (persistent memory across sessions).

Output ONLY a single JSON object — no explanation, no markdown fences — exactly in this shape:
{"projectName":"<short name>","brief":"<shared context>","questions":["<q1>","<q2>"],
"roles":[{"role":"Backend","folder":"server","task":"<what to build>","provider":"claude","model":null}],
"skillSearch":["<keyword>"],"connectors":[{"name":"chrome","reason":"<why>"}]}`;
}

export function extractJson(text: string): any | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Validate the model's JSON against the offered engines (pure — unit-tested).
 *  Unknown providers fall back to the first engine; unknown models to default. */
export function parsePlan(text: string, engines: EngineOption[]): OrchestratorPlan {
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.roles)) return { ok: false, error: "Could not produce a plan." };
  const byId = new Map(engines.map((e) => [e.id, e]));
  const fallback = engines[0]?.id ?? "claude";
  const roles: PlannedRole[] = parsed.roles
    .filter((r: any) => r && r.role && r.folder && r.task)
    .slice(0, 6)
    .map((r: any) => {
      const provider = byId.has(String(r.provider)) ? String(r.provider) : fallback;
      const engine = byId.get(provider)!;
      const model =
        typeof r.model === "string" && engine.models.includes(r.model) ? r.model : null;
      return { role: String(r.role), folder: String(r.folder), task: String(r.task), provider, model };
    });
  if (roles.length < 1) return { ok: false, error: "No roles in the plan." };
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q: any) => typeof q === "string" && q.trim()).slice(0, 4)
    : [];
  const skillSearch = Array.isArray(parsed.skillSearch)
    ? parsed.skillSearch
        .filter((q: any) => typeof q === "string" && q.trim())
        .map((q: any) => String(q).trim().slice(0, 60))
        .slice(0, 3)
    : [];
  const connectors = Array.isArray(parsed.connectors)
    ? parsed.connectors
        .filter((c: any) => c && typeof c.name === "string" && /^[a-z0-9-]{2,30}$/.test(c.name.trim().toLowerCase()))
        .map((c: any) => ({
          name: String(c.name).trim().toLowerCase(),
          reason: typeof c.reason === "string" ? c.reason.slice(0, 200) : "",
        }))
        .slice(0, 2)
    : [];
  return {
    ok: true,
    projectName: String(parsed.projectName ?? "project"),
    brief: String(parsed.brief ?? ""),
    questions,
    roles,
    skillSearch,
    connectors,
  };
}

/** Plan-mode run: produce brief + roles + engine/model assignments + questions.
 *  No project is created here — the user reviews and confirms first. */
export async function planOrchestration(
  goal: string,
  answers: string | undefined,
  engines: EngineOption[],
  cwd: string,
  references?: PlanReference[],
): Promise<OrchestratorPlan> {
  let resultText = "";
  const prompt =
    `Goal: ${goal}\n\n` +
    (answers
      ? `The user answered your earlier structure questions and/or added instructions:\n${answers}\n\n` +
        `Refine the plan accordingly. If the new input leaves something essential ambiguous, ask up to 2 NEW ` +
        `questions; otherwise return an empty questions array.\n\n`
      : "") +
    "Output the JSON plan (and nothing else).";
  try {
    const q = query({
      prompt,
      options: {
        cwd,
        allowedTools: [],
        permissionMode: "dontAsk",
        maxTurns: 4,
        settingSources: [],
        systemPrompt: { type: "preset", preset: "claude_code", append: planInstructions(engines, references) },
        env: buildAgentEnv(),
      } as any,
    });
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === "result") resultText = m.result ?? "";
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "planner failed" };
  }
  return parsePlan(resultText, engines);
}
