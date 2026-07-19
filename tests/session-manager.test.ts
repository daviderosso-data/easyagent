import { describe, it, expect, afterEach } from "vitest";
import { sessionManager } from "@/server/session-manager";

// Regression harness for the turn-lifecycle class of bugs (stranded turns and
// leaked concurrency slots). These guard the Phase 1 fixes.

const created: string[] = [];
function track(id: string) { created.push(id); return id; }

afterEach(() => {
  // Release anything a test left registered so the shared singleton is clean.
  for (const id of created.splice(0)) sessionManager.end(id);
});

describe("tryCreate concurrency cap", () => {
  it("reserves slots atomically up to max and refuses beyond it", () => {
    const base = sessionManager.size();
    const max = base + 2;
    const a = sessionManager.tryCreate(track("cap-a"), new AbortController(), max);
    const b = sessionManager.tryCreate(track("cap-b"), new AbortController(), max);
    const c = sessionManager.tryCreate(track("cap-c"), new AbortController(), max);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).toBeNull(); // over the cap
    expect(sessionManager.size()).toBe(max);
  });

  it("frees a slot on end so a new turn can be created", () => {
    const base = sessionManager.size();
    const max = base + 1;
    const a = sessionManager.tryCreate(track("free-a"), new AbortController(), max);
    expect(a).not.toBeNull();
    expect(sessionManager.tryCreate("free-b", new AbortController(), max)).toBeNull();
    sessionManager.end("free-a");
    const b = sessionManager.tryCreate(track("free-b2"), new AbortController(), max);
    expect(b).not.toBeNull();
  });
});

describe("end() releases the slot and fails closed", () => {
  it("removes the turn and resolves pending approvals as deny", () => {
    const turn = sessionManager.tryCreate(track("end-a"), new AbortController(), 99)!;
    let decided: { allow: boolean } | null = null;
    turn.pendingApprovals.set("ap1", (d) => { decided = d; });
    const before = sessionManager.size();
    sessionManager.end("end-a");
    expect(sessionManager.get("end-a")).toBeUndefined();
    expect(sessionManager.size()).toBe(before - 1);
    expect(decided).not.toBeNull();
    expect(decided!.allow).toBe(false); // fail-closed
  });

  it("is a no-op when called twice or on an unknown id", () => {
    sessionManager.tryCreate(track("twice-a"), new AbortController(), 99);
    sessionManager.end("twice-a");
    expect(() => sessionManager.end("twice-a")).not.toThrow();
    expect(() => sessionManager.end("never-existed")).not.toThrow();
  });
});

describe("abort() interrupts and aborts", () => {
  it("aborts the turn's controller and calls query.interrupt", () => {
    const ctrl = new AbortController();
    const turn = sessionManager.tryCreate(track("abort-a"), ctrl, 99)!;
    let interrupted = false;
    turn.query = { interrupt: () => { interrupted = true; } };
    sessionManager.abort("abort-a");
    expect(ctrl.signal.aborted).toBe(true);
    expect(interrupted).toBe(true);
  });

  it("does not throw on an unknown id", () => {
    expect(() => sessionManager.abort("nope")).not.toThrow();
  });
});

describe("anyRunningUnder()", () => {
  it("matches exact cwd and subfolders, not sibling prefixes", () => {
    const turn = sessionManager.tryCreate(track("under-a"), new AbortController(), 99)!;
    turn.cwd = "/home/u/easyclaude/foo";
    expect(sessionManager.anyRunningUnder("/home/u/easyclaude/foo")).toBe(true);
    expect(sessionManager.anyRunningUnder("/home/u/easyclaude")).toBe(true);
    expect(sessionManager.anyRunningUnder("/home/u/easyclaude/foobar")).toBe(false);
    expect(sessionManager.anyRunningUnder("/home/u/easyclaude/fo")).toBe(false);
    sessionManager.end("under-a");
    expect(sessionManager.anyRunningUnder("/home/u/easyclaude/foo")).toBe(false);
  });

  it("ignores turns without a cwd", () => {
    sessionManager.tryCreate(track("under-b"), new AbortController(), 99);
    expect(sessionManager.anyRunningUnder("/anywhere")).toBe(false);
    sessionManager.end("under-b");
  });
});
