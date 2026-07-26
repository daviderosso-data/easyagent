import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AgentEvent } from "@/lib/agent-events";
import { PROFILES } from "@/lib/settings";
import { sessionManager } from "@/server/session-manager";
import { runOllamaTurn } from "@/server/providers/ollama/runner";

// Live integration of the Ollama tool loop against the local daemon
// (non-deterministic model behavior → opt-in only: OLLAMA_LIVE=1).
const LIVE = process.env.OLLAMA_LIVE === "1";

const WS = join(homedir(), "easyagent", "ollama-live-test");

function setup(turnId: string) {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });
  writeFileSync(join(WS, "README.md"), "# demo\n", "utf8");
  const turn = sessionManager.tryCreate(turnId, new AbortController(), 99)!;
  const events: AgentEvent[] = [];
  return { turn, events };
}

describe.skipIf(!LIVE)("ollama live tool loop", () => {
  it("creates a file via write_file under behavior=auto", { timeout: 180_000 }, async () => {
    const { turn, events } = setup("ol-live-auto");
    try {
      await runOllamaTurn({
        turnId: "ol-live-auto",
        turn,
        prompt: "Create a file named hello.md containing exactly: ciao. Use the write_file tool.",
        cwd: WS,
        config: PROFILES.standard,
        lang: "en",
        send: (e) => events.push(e),
      });
    } finally {
      sessionManager.end("ol-live-auto");
    }
    const done = events.find((e) => e.type === "done");
    expect(done, JSON.stringify(events.slice(-3))).toBeTruthy();
    expect(events.some((e) => e.type === "tool_use" && e.name === "Write")).toBe(true);
    expect(existsSync(join(WS, "hello.md"))).toBe(true);
    expect(readFileSync(join(WS, "hello.md"), "utf8")).toContain("ciao");
  });

  it("routes writes through the approval flow under behavior=ask", { timeout: 180_000 }, async () => {
    const { turn, events } = setup("ol-live-ask");
    let sawApproval = false;
    const send = (e: AgentEvent) => {
      events.push(e);
      if (e.type === "approval_request") {
        sawApproval = true;
        // Approve asynchronously, like the UI would.
        setTimeout(() => turn.pendingApprovals.get(e.approvalId)?.resolve({ allow: true }), 50);
      }
    };
    try {
      await runOllamaTurn({
        turnId: "ol-live-ask",
        turn,
        prompt: "Create a file named approved.md containing exactly: si. Use the write_file tool.",
        cwd: WS,
        config: PROFILES.locked,
        lang: "en",
        send,
      });
    } finally {
      sessionManager.end("ol-live-ask");
      rmSync(WS, { recursive: true, force: true });
    }
    expect(sawApproval).toBe(true);
    expect(events.find((e) => e.type === "done")).toBeTruthy();
  });
});
