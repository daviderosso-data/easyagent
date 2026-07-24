import { describe, expect, test } from "vitest";
import { copilotSafetyArgs, mapCopilotEvent, type MapCtx } from "@/server/providers/copilot/runner";
import { PROFILES } from "@/lib/settings";

// Event samples captured live from @github/copilot 1.0.74 (2026-07-24).

function ctx(): MapCtx {
  return { turnId: "t1", fallbackSessionId: "", streamed: new Map(), lastError: "" };
}

describe("mapCopilotEvent", () => {
  test("streams deltas and does not double the final message", () => {
    const c = ctx();
    const delta = mapCopilotEvent(
      { type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "OK" } },
      c,
    );
    expect(delta).toEqual([{ type: "text", id: "m1", text: "OK" }]);
    const final = mapCopilotEvent(
      { type: "assistant.message", data: { messageId: "m1", content: "OK", toolRequests: [] } },
      c,
    );
    expect(final).toEqual([]);
  });

  test("emits the missing tail when deltas were partial", () => {
    const c = ctx();
    mapCopilotEvent({ type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "Hel" } }, c);
    const final = mapCopilotEvent({ type: "assistant.message", data: { messageId: "m1", content: "Hello" } }, c);
    expect(final).toEqual([{ type: "text", id: "m1", text: "lo" }]);
  });

  test("maps tool execution to tool_use / tool_result with the diff", () => {
    const c = ctx();
    const start = mapCopilotEvent(
      {
        type: "tool.execution_start",
        data: { toolCallId: "call_1", toolName: "create", arguments: { path: "/x/hello.txt", file_text: "hi" } },
      },
      c,
    );
    expect(start).toEqual([
      { type: "tool_use", id: "call_1", name: "create", input: { path: "/x/hello.txt", file_text: "hi" } },
    ]);
    const done = mapCopilotEvent(
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "call_1",
          success: true,
          result: { content: "Created file /x/hello.txt", detailedContent: "diff --git ..." },
        },
      },
      c,
    );
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ type: "tool_result", toolUseId: "call_1", isError: false });
    expect((done[0] as { content: string }).content).toContain("Created file");
    expect((done[0] as { content: string }).content).toContain("diff --git");
  });

  test("maps the result line to done with the session id for resume", () => {
    const c = ctx();
    const out = mapCopilotEvent(
      {
        type: "result",
        sessionId: "c95a870f",
        exitCode: 0,
        usage: { premiumRequests: 0, sessionDurationMs: 5753 },
      },
      c,
    );
    expect(out).toEqual([
      {
        type: "done",
        sessionId: "c95a870f",
        isError: false,
        subtype: "success",
        numTurns: 1,
        durationMs: 5753,
        totalCostUsd: 0,
        usage: null,
      },
    ]);
  });

  test("ignores session chatter and surfaces errors", () => {
    const c = ctx();
    expect(mapCopilotEvent({ type: "session.mcp_servers_loaded", data: {} }, c)).toEqual([]);
    expect(mapCopilotEvent({ type: "assistant.turn_start", data: { turnId: "0" } }, c)).toEqual([]);
    const err = mapCopilotEvent({ type: "error", data: { message: "boom" } }, c);
    expect(err).toEqual([{ type: "error", message: "boom" }]);
    expect(c.lastError).toBe("boom");
  });
});

describe("copilotSafetyArgs", () => {
  test("confined profiles keep path verification and gate URLs by policy", () => {
    expect(copilotSafetyArgs(PROFILES.locked)).toEqual(["--allow-all-tools"]);
    expect(copilotSafetyArgs(PROFILES.standard)).toEqual(["--allow-all-tools", "--allow-all-urls"]);
  });

  test("open profile allows everything", () => {
    expect(copilotSafetyArgs(PROFILES.open)).toEqual(["--allow-all"]);
  });
});
