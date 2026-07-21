import { describe, it, expect } from "vitest";
import { getProvider, defaultProvider, listProviders, DEFAULT_PROVIDER_ID } from "@/server/providers";
import { claudeProvider } from "@/server/providers/claude";
import { recordingSend, runTurn } from "@/server/agent-runner";
import { sessionManager } from "@/server/session-manager";
import type { AgentEvent } from "@/lib/agent-events";
import type { UsageEvent } from "@/lib/usage-types";
import { PROFILES } from "@/lib/settings";

// P5 provider abstraction: the registry, the provider contract, and the
// neutral pipeline (usage recording + guaranteed slot release).

describe("provider registry", () => {
  it("defaults to claude", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("claude");
    expect(defaultProvider().id).toBe("claude");
    expect(getProvider()).toBe(claudeProvider);
    expect(getProvider(null)).toBe(claudeProvider);
    expect(getProvider("")).toBe(claudeProvider);
  });

  it("resolves known ids and rejects unknown ones", () => {
    expect(getProvider("claude")).toBe(claudeProvider);
    expect(getProvider("gpt-9000")).toBeNull();
    expect(getProvider("codex")).toBeNull(); // not registered until P6
  });

  it("lists only registered providers", () => {
    expect(listProviders().map((p) => p.id)).toEqual(["claude"]);
  });
});

describe("claude provider contract", () => {
  it("exposes the full capability set and both facets", () => {
    expect(claudeProvider.label).toBe("Claude Code");
    expect(claudeProvider.capabilities).toEqual({
      approvals: true,
      mcp: true,
      skills: true,
      resume: true,
      effort: true,
      slashCommands: true,
      rateLimits: true,
    });
    expect(typeof claudeProvider.runTurn).toBe("function");
    expect(claudeProvider.account).toBeDefined();
    expect(claudeProvider.history).toBeDefined();
  });
});

function collect() {
  const events: AgentEvent[] = [];
  const records: UsageEvent[] = [];
  const send = recordingSend((e) => events.push(e), { provider: "claude", project: "demo", effort: "high" }, (u) =>
    records.push(u),
  );
  return { events, records, send };
}

const READY: AgentEvent = {
  type: "ready",
  turnId: "t1",
  sessionId: "s-live",
  model: "claude-test-1",
  tools: [],
  slashCommands: [],
  apiKeySource: "none",
};

describe("recordingSend usage recorder", () => {
  it("records a completed turn with model/session from ready and parsed tokens", () => {
    const { events, records, send } = collect();
    send(READY);
    send({
      type: "done",
      sessionId: "s-final",
      isError: false,
      subtype: "success",
      numTurns: 3,
      durationMs: 1234,
      totalCostUsd: 0.5,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 5 },
    });
    expect(events).toHaveLength(2); // pass-through preserved
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      model: "claude-test-1",
      sessionId: "s-final",
      provider: "claude",
      project: "demo",
      effort: "high",
      costUsd: 0.5,
      inTok: 10,
      outTok: 20,
      cacheTok: 35,
      numTurns: 3,
      durationMs: 1234,
      status: "ok",
      subtype: "success",
    });
  });

  it("records aborted and errored turns distinctly", () => {
    const aborted = collect();
    aborted.send({ type: "done", sessionId: "", isError: false, subtype: "aborted", numTurns: 0, durationMs: 0, totalCostUsd: 0, usage: null });
    expect(aborted.records[0]).toMatchObject({ status: "aborted", subtype: "aborted", costUsd: 0 });

    const errored = collect();
    errored.send({ type: "error", message: "boom" });
    expect(errored.records[0]).toMatchObject({ status: "error", subtype: "error", inTok: 0, outTok: 0 });

    const failed = collect();
    failed.send({ type: "done", sessionId: "s", isError: true, subtype: "error_max_turns", numTurns: 1, durationMs: 1, totalCostUsd: 0.1, usage: {} });
    expect(failed.records[0]).toMatchObject({ status: "error", subtype: "error_max_turns" });
  });

  it("records only the first terminal event and tolerates junk usage", () => {
    const { records, send } = collect();
    send({ type: "done", sessionId: "s", isError: false, subtype: "success", numTurns: 1, durationMs: 1, totalCostUsd: 0, usage: { input_tokens: "NaN-ish" } });
    send({ type: "error", message: "late failure" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "ok", inTok: 0 });
  });

  it("falls back to request model/session when the turn dies before ready", () => {
    const events: AgentEvent[] = [];
    const records: UsageEvent[] = [];
    const send = recordingSend(
      (e) => events.push(e),
      { provider: "claude", project: "demo", model: "claude-req", sessionId: "s-req" },
      (u) => records.push(u),
    );
    send({ type: "error", message: "no init" });
    expect(records[0]).toMatchObject({ model: "claude-req", sessionId: "s-req", status: "error" });
  });
});

describe("runTurn pipeline", () => {
  it("emits an error and releases the slot when the provider id is unknown", async () => {
    const turnId = "p5-unknown-provider";
    const turn = sessionManager.tryCreate(turnId, new AbortController(), 99)!;
    const events: AgentEvent[] = [];
    await runTurn({
      turnId,
      turn,
      prompt: "hi",
      cwd: "/tmp/nowhere",
      config: PROFILES.locked,
      lang: "en",
      provider: "gpt-9000",
      send: (e) => events.push(e),
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(sessionManager.get(turnId)).toBeUndefined(); // slot released
  });
});
