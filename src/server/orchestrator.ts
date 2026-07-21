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
  error?: string;
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

function planInstructions(engines: EngineOption[]): string {
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

Output ONLY a single JSON object — no explanation, no markdown fences — exactly in this shape:
{"projectName":"<short name>","brief":"<shared context>","questions":["<q1>","<q2>"],
"roles":[{"role":"Backend","folder":"server","task":"<what to build>","provider":"claude","model":null}]}`;
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
  return {
    ok: true,
    projectName: String(parsed.projectName ?? "project"),
    brief: String(parsed.brief ?? ""),
    questions,
    roles,
  };
}

/** Plan-mode run: produce brief + roles + engine/model assignments + questions.
 *  No project is created here — the user reviews and confirms first. */
export async function planOrchestration(
  goal: string,
  answers: string | undefined,
  engines: EngineOption[],
  cwd: string,
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
        systemPrompt: { type: "preset", preset: "claude_code", append: planInstructions(engines) },
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
