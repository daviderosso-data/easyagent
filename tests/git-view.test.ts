import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { projectGitStatus, projectGitCommit, projectGitInit } from "@/server/git-view";
import { gitAvailable } from "@/server/git-exec";
import { PROJECTS_ROOT } from "@/server/projects";

const WS = join(PROJECTS_ROOT, "git-view-test");
const hasGit = await gitAvailable();

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });
});
afterAll(() => {
  rmSync(WS, { recursive: true, force: true });
});

describe.skipIf(!hasGit)("git view", () => {
  it("reports no repo for a plain folder", async () => {
    const s = await projectGitStatus(WS);
    expect(s.hasRepo).toBe(false);
  });

  it("init → repo on main; new files show as 'new'; commit cleans", async () => {
    expect((await projectGitInit(WS)).ok).toBe(true);
    writeFileSync(join(WS, "index.html"), "<html>");
    let s = await projectGitStatus(WS);
    expect(s.hasRepo).toBe(true);
    expect(s.branch).toBe("main");
    expect(s.hasRemote).toBe(false);
    expect(s.files).toEqual([{ path: "index.html", status: "new" }]);

    // Works even without a configured git identity (fallback retry).
    expect((await projectGitCommit(WS, "first commit")).ok).toBe(true);
    s = await projectGitStatus(WS);
    expect(s.files).toHaveLength(0);
  });

  it("maps modified and deleted statuses", async () => {
    await projectGitInit(WS);
    writeFileSync(join(WS, "a.txt"), "1");
    writeFileSync(join(WS, "b.txt"), "1");
    await projectGitCommit(WS, "base");
    writeFileSync(join(WS, "a.txt"), "2");
    rmSync(join(WS, "b.txt"));
    const s = await projectGitStatus(WS);
    const byPath = Object.fromEntries(s.files.map((f) => [f.path, f.status]));
    expect(byPath["a.txt"]).toBe("modified");
    expect(byPath["b.txt"]).toBe("deleted");
  });
});
