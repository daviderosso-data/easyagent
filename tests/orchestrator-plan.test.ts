import { describe, it, expect } from "vitest";
import { parsePlan, type EngineOption } from "@/server/orchestrator";

const ENGINES: EngineOption[] = [
  { id: "claude", label: "Claude Code", models: [null, "claude-haiku-4-5", "claude-sonnet-5"], local: false },
  { id: "ollama", label: "Ollama (local)", models: [null, "qwen2.5:latest"], local: true },
];

function planText(overrides: object = {}) {
  return (
    "Here is the plan:\n" +
    JSON.stringify({
      projectName: "shop",
      brief: "Next.js + SQLite",
      questions: ["Which payment provider?", "Mobile-first?"],
      roles: [
        { role: "Backend", folder: "server", task: "API", provider: "claude", model: "claude-sonnet-5" },
        { role: "Copy", folder: "copy", task: "Texts", provider: "ollama", model: "qwen2.5:latest" },
      ],
      ...overrides,
    })
  );
}

describe("parsePlan", () => {
  it("accepts a valid plan with engine/model assignments and questions", () => {
    const p = parsePlan(planText(), ENGINES);
    expect(p.ok).toBe(true);
    expect(p.projectName).toBe("shop");
    expect(p.questions).toEqual(["Which payment provider?", "Mobile-first?"]);
    expect(p.roles![0]).toMatchObject({ provider: "claude", model: "claude-sonnet-5" });
    expect(p.roles![1]).toMatchObject({ provider: "ollama", model: "qwen2.5:latest" });
  });

  it("falls back on unknown providers and models instead of failing", () => {
    const p = parsePlan(
      planText({
        roles: [{ role: "X", folder: "x", task: "t", provider: "gpt-9000", model: "made-up" }],
      }),
      ENGINES,
    );
    expect(p.ok).toBe(true);
    expect(p.roles![0]).toMatchObject({ provider: "claude", model: null });
  });

  it("caps roles at 3 and questions at 4, dropping junk entries", () => {
    const p = parsePlan(
      planText({
        questions: ["a", "b", "c", "d", "e", 42, ""],
        roles: Array.from({ length: 5 }, (_, i) => ({ role: `R${i}`, folder: `f${i}`, task: "t", provider: "claude", model: null })),
      }),
      ENGINES,
    );
    expect(p.roles).toHaveLength(3);
    expect(p.questions).toEqual(["a", "b", "c", "d"]);
  });

  it("fails closed without roles or without JSON", () => {
    expect(parsePlan("no json here", ENGINES).ok).toBe(false);
    expect(parsePlan(planText({ roles: [] }), ENGINES).ok).toBe(false);
  });
});
