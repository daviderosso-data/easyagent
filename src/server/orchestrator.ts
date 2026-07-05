import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildAgentEnv } from "@/server/security";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RolePlan {
  role: string;
  folder: string;
  task: string;
}
export interface OrchestratorPlan {
  ok: boolean;
  projectName?: string;
  brief?: string;
  roles?: RolePlan[];
  error?: string;
}

const INSTRUCTIONS = `You are the ORCHESTRATOR of a new software project. The user gives a goal.
Design the project from scratch and split the work into 2 to 3 specialized roles that fit THIS goal —
for example Backend, Frontend, Design, Copy, but choose whatever actually fits (a CLI tool or a data
script may need different roles).

Choose a short PROJECT NAME (a few words). Produce a SHARED BRIEF: the common decisions every role MUST
follow to stay consistent — tech stack, data/API contracts, file/naming conventions, how the pieces fit
together, and visual/tone guidelines. For each role, choose a short lowercase folder name
(letters/dashes, no spaces) where that role will work, and a concrete, self-contained task.

Output ONLY a single JSON object — no explanation, no markdown code fences — exactly in this shape:
{"projectName":"<short name>","brief":"<shared context every role must follow>","roles":[{"role":"Backend","folder":"server","task":"<what to build>"},{"role":"Frontend","folder":"web","task":"<what to build>"}]}`;

function extractJson(text: string): any | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function runOrchestrator(goal: string, cwd: string): Promise<OrchestratorPlan> {
  let resultText = "";
  try {
    const q = query({
      prompt: `Goal: ${goal}\n\nAnalyze the project, then output the JSON plan (and nothing else).`,
      options: {
        cwd,
        allowedTools: ["Read", "Glob", "Grep", "LS"],
        permissionMode: "dontAsk", // read-only, never prompts
        settingSources: [],
        systemPrompt: { type: "preset", preset: "claude_code", append: INSTRUCTIONS },
        env: buildAgentEnv(),
        maxTurns: 12,
      } as any,
    });
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === "result") resultText = m.result ?? "";
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "orchestrator failed" };
  }

  const parsed = extractJson(resultText);
  if (!parsed || !Array.isArray(parsed.roles)) return { ok: false, error: "Could not produce a plan." };
  const roles: RolePlan[] = parsed.roles
    .filter((r: any) => r && r.role && r.folder && r.task)
    .slice(0, 3)
    .map((r: any) => ({ role: String(r.role), folder: String(r.folder), task: String(r.task) }));
  if (roles.length < 1) return { ok: false, error: "No roles in the plan." };
  return {
    ok: true,
    projectName: String(parsed.projectName ?? "project"),
    brief: String(parsed.brief ?? ""),
    roles,
  };
}
