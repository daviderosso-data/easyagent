import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { GET as historyGet } from "@/app/api/history/route";
import { GET as diffGet } from "@/app/api/history/diff/route";
import { POST as restorePost } from "@/app/api/history/restore/route";
import { SESSION_TOKEN } from "@/server/security";
import { sessionManager } from "@/server/session-manager";
import { PROJECTS_ROOT } from "@/server/projects";

const WS = join(PROJECTS_ROOT, "history-routes-test");
const auth = { "x-ccw-token": SESSION_TOKEN, "content-type": "application/json" };

afterEach(() => {
  rmSync(WS, { recursive: true, force: true });
});

describe("history routes auth", () => {
  it("rejects requests without the session token", async () => {
    expect((await historyGet(new Request(`http://x/api/history?cwd=${WS}`))).status).toBe(403);
    expect((await diffGet(new Request(`http://x/api/history/diff?cwd=${WS}&hash=abc1234`))).status).toBe(403);
    const r = await restorePost(
      new Request("http://x/api/history/restore", { method: "POST", body: JSON.stringify({ cwd: WS, hash: "a".repeat(40) }) })
    );
    expect(r.status).toBe(403);
  });

  it("rejects invalid cwd and malformed hash", async () => {
    expect((await historyGet(new Request("http://x/api/history?cwd=/etc", { headers: auth }))).status).toBe(400);
    mkdirSync(WS, { recursive: true });
    expect((await diffGet(new Request(`http://x/api/history/diff?cwd=${WS}&hash=NOT-a-hash`, { headers: auth }))).status).toBe(400);
  });

  it("returns 409 when a turn is running in the project", async () => {
    mkdirSync(WS, { recursive: true });
    const turn = sessionManager.tryCreate("hist-busy", new AbortController(), 99)!;
    turn.cwd = WS;
    try {
      const r = await restorePost(
        new Request("http://x/api/history/restore", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ cwd: WS, hash: "a".repeat(40) }),
        })
      );
      expect(r.status).toBe(409);
    } finally {
      sessionManager.end("hist-busy");
    }
  });
});
