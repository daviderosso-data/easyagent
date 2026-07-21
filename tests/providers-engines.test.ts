import { describe, it, expect } from "vitest";
import { PROFILES, ORCHESTRATION_CONFIG } from "@/lib/settings";
import { codexSafetyArgs, codexExecArgs, mapCodexEvent, type CodexMapCtx } from "@/server/providers/codex/runner";
import { grokSafetyArgs, grokEffort, mapGrokEvent } from "@/server/providers/grok/runner";
import type { AgentEvent } from "@/lib/agent-events";

// P6 engine adapters: security-profile → CLI flags mapping and native-event →
// AgentEvent mapping (pure functions).

describe("codexSafetyArgs", () => {
  it("confined profiles can edit files (workspace-write via -c, resume-safe); network follows the profile", () => {
    expect(codexSafetyArgs(PROFILES.locked)).toEqual(["-c", "sandbox_mode=workspace-write"]);
    expect(codexSafetyArgs(PROFILES.standard)).toEqual([
      "-c", "sandbox_mode=workspace-write", "-c", "sandbox_workspace_write.network_access=true",
    ]);
    expect(codexSafetyArgs(PROFILES.open)).toEqual(["-c", "sandbox_mode=danger-full-access"]);
  });

  it("keeps orchestration turns sandboxed despite behavior=open", () => {
    expect(codexSafetyArgs(ORCHESTRATION_CONFIG)).toEqual([
      "-c", "sandbox_mode=workspace-write", "-c", "sandbox_workspace_write.network_access=true",
    ]);
  });
});

describe("codexExecArgs", () => {
  it("new turns carry effort + safety overrides + model before the prompt", () => {
    expect(codexExecArgs({ model: "gpt-5.5", effort: "max", config: PROFILES.locked, prompt: "hi" })).toEqual([
      "exec", "--json", "--skip-git-repo-check", "-c", "model_reasoning_effort=xhigh", "-c", "sandbox_mode=workspace-write", "-m", "gpt-5.5", "hi",
    ]);
  });

  it("resume keeps -c overrides (they un-stick read-only threads) but drops -m; flags precede the session id", () => {
    expect(codexExecArgs({ sessionId: "th_1", model: "gpt-5.5", config: PROFILES.locked, prompt: "hi" })).toEqual([
      "exec", "resume", "--json", "--skip-git-repo-check", "-c", "sandbox_mode=workspace-write", "th_1", "hi",
    ]);
  });
});

describe("grokSafetyArgs / grokEffort", () => {
  it("confined profiles can edit files inside the workspace sandbox", () => {
    expect(grokSafetyArgs(PROFILES.locked)).toEqual(["--sandbox", "workspace", "--permission-mode", "acceptEdits"]);
    expect(grokSafetyArgs(PROFILES.standard)).toEqual(["--sandbox", "workspace", "--permission-mode", "acceptEdits"]);
    expect(grokSafetyArgs(PROFILES.open)).toEqual(["--permission-mode", "bypassPermissions"]);
  });

  it("keeps orchestration turns sandboxed despite behavior=open", () => {
    expect(grokSafetyArgs(ORCHESTRATION_CONFIG)).toEqual(["--sandbox", "workspace", "--permission-mode", "bypassPermissions"]);
  });

  it("maps our effort scale onto grok's", () => {
    expect(grokEffort("low")).toBe("low");
    expect(grokEffort("xhigh")).toBe("xhigh");
    expect(grokEffort("max")).toBe("xhigh");
  });
});

function codexCtx(): CodexMapCtx {
  return { turnId: "t1", model: "codex", sessionId: "", started: Date.now(), startedItems: new Set(), lastError: "" };
}

describe("mapCodexEvent", () => {
  it("thread.started → ready and captures the session id", () => {
    const ctx = codexCtx();
    const out = mapCodexEvent({ type: "thread.started", thread_id: "th_1" }, ctx);
    expect(out[0]).toMatchObject({ type: "ready", sessionId: "th_1", apiKeySource: "subscription" });
    expect(ctx.sessionId).toBe("th_1");
  });

  it("agent_message → text, reasoning → thinking", () => {
    const ctx = codexCtx();
    expect(mapCodexEvent({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "hi" } }, ctx)[0]).toMatchObject({ type: "text", text: "hi" });
    expect(mapCodexEvent({ type: "item.completed", item: { id: "i2", type: "reasoning", text: "hmm" } }, ctx)[0]).toMatchObject({ type: "thinking", text: "hmm" });
  });

  it("command_execution completes into tool_use + tool_result with error flag", () => {
    const ctx = codexCtx();
    const out = mapCodexEvent(
      { type: "item.completed", item: { id: "c1", type: "command_execution", command: "false", aggregated_output: "boom", exit_code: 1 } },
      ctx,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "tool_use", id: "c1", name: "Bash", input: { command: "false" } });
    expect(out[1]).toMatchObject({ type: "tool_result", toolUseId: "c1", content: "boom", isError: true });
  });

  it("does not repeat tool_use when the item was already started", () => {
    const ctx = codexCtx();
    const started = mapCodexEvent({ type: "item.started", item: { id: "c1", type: "command_execution", command: "ls" } }, ctx);
    expect(started).toHaveLength(1);
    expect(started[0].type).toBe("tool_use");
    const completed = mapCodexEvent(
      { type: "item.completed", item: { id: "c1", type: "command_execution", command: "ls", aggregated_output: "ok", exit_code: 0 } },
      ctx,
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ type: "tool_result", isError: false });
  });

  it("turn.completed → done with normalized usage keys", () => {
    const ctx = codexCtx();
    ctx.sessionId = "th_1";
    const out = mapCodexEvent(
      { type: "turn.completed", usage: { input_tokens: 5, cached_input_tokens: 7, output_tokens: 9 } },
      ctx,
    );
    expect(out[0]).toMatchObject({
      type: "done",
      sessionId: "th_1",
      isError: false,
      usage: { input_tokens: 5, output_tokens: 9, cache_read_input_tokens: 7 },
    });
  });

  it("turn.failed → error; loose error events only feed lastError", () => {
    const ctx = codexCtx();
    expect(mapCodexEvent({ type: "error", message: "retrying…" }, ctx)).toEqual([]);
    expect(ctx.lastError).toBe("retrying…");
    const out = mapCodexEvent({ type: "turn.failed", error: { message: "401 Unauthorized" } }, ctx);
    expect(out[0]).toMatchObject({ type: "error", message: "401 Unauthorized" });
  });
});

describe("mapGrokEvent", () => {
  const ctx = { turnId: "t1", msgId: "m1", fallbackSessionId: "s0", started: Date.now() };

  it("maps the documented event vocabulary", () => {
    expect(mapGrokEvent({ type: "text", text: "ciao" }, ctx)[0]).toMatchObject({ type: "text", text: "ciao" });
    expect(mapGrokEvent({ type: "thought", text: "mm" }, ctx)[0]).toMatchObject({ type: "thinking", text: "mm" });
    expect(mapGrokEvent({ type: "error", message: "nope" }, ctx)[0]).toMatchObject({ type: "error", message: "nope" });
    const done = mapGrokEvent(
      { type: "end", sessionId: "s9", usage: { input_tokens: 1, output_tokens: 2 }, total_cost_usd: 0.5 },
      ctx,
    )[0] as Extract<AgentEvent, { type: "done" }>;
    expect(done).toMatchObject({ type: "done", sessionId: "s9", totalCostUsd: 0.5 });
  });

  it("falls back to the request session id and ignores unknown types", () => {
    const done = mapGrokEvent({ type: "end" }, ctx)[0] as Extract<AgentEvent, { type: "done" }>;
    expect(done.sessionId).toBe("s0");
    expect(mapGrokEvent({ type: "auto_compact_started" }, ctx)).toEqual([]);
    expect(mapGrokEvent(null, ctx)).toEqual([]);
  });
});
