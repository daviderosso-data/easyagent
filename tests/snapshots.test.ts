import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  projectRootFor,
  shadowGitDir,
  snapshotBeforeTurn,
  listSavePoints,
  diffSavePoint,
  restoreSavePoint,
} from "@/server/snapshots";
import { gitAvailable, runGit } from "@/server/git-exec";
import { PROJECTS_ROOT } from "@/server/projects";

const WS = join(PROJECTS_ROOT, "snapshots-test");
const hasGit = await gitAvailable();

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true });
  rmSync(shadowGitDir(WS), { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });
});
afterAll(() => {
  rmSync(WS, { recursive: true, force: true });
  rmSync(shadowGitDir(WS), { recursive: true, force: true });
});

describe("projectRootFor", () => {
  it("maps a subfolder to its top-level project", () => {
    mkdirSync(join(WS, "role-a"), { recursive: true });
    expect(projectRootFor(join(WS, "role-a"))).toBe(WS);
    expect(projectRootFor(WS)).toBe(WS);
  });
  it("rejects the projects root itself and outside paths", () => {
    expect(projectRootFor(PROJECTS_ROOT)).toBeNull();
    expect(projectRootFor(join(homedir(), "somewhere-else"))).toBeNull();
    expect(projectRootFor(join(PROJECTS_ROOT, "does-not-exist-xyz"))).toBeNull();
  });
});

describe.skipIf(!hasGit)("snapshotBeforeTurn", () => {
  it("creates the shadow repo and a first save point; project stays clean", async () => {
    writeFileSync(join(WS, "app.js"), "console.log(1)\n");
    await snapshotBeforeTurn(WS, "  add   a contact form ", "turn-1");
    const list = await listSavePoints(WS);
    expect(list.points).toHaveLength(1);
    expect(list.points[0].label).toBe("add a contact form");
    expect(existsSync(join(WS, ".git"))).toBe(false);
  });

  it("skips when nothing changed since the last point", async () => {
    writeFileSync(join(WS, "a.txt"), "one");
    await snapshotBeforeTurn(WS, "first", "t1");
    await snapshotBeforeTurn(WS, "second (no changes)", "t2");
    expect((await listSavePoints(WS)).points).toHaveLength(1);
  });

  it("never tracks excluded folders", async () => {
    mkdirSync(join(WS, "node_modules"), { recursive: true });
    writeFileSync(join(WS, "node_modules", "x.js"), "dep");
    writeFileSync(join(WS, "index.html"), "<html>");
    await snapshotBeforeTurn(WS, "p", "t1");
    const files = await runGit(
      ["--git-dir", shadowGitDir(WS), "--work-tree", WS, "ls-tree", "-r", "--name-only", "HEAD"],
      { cwd: WS }
    );
    expect(files.stdout).toContain("index.html");
    expect(files.stdout).not.toContain("node_modules");
  });
});

describe.skipIf(!hasGit)("diff and restore", () => {
  it("diffs a save point against current files", async () => {
    writeFileSync(join(WS, "a.txt"), "old content\n");
    await snapshotBeforeTurn(WS, "before", "t1");
    writeFileSync(join(WS, "a.txt"), "new content\n");
    writeFileSync(join(WS, "b.txt"), "created later\n");
    const { hash } = (await listSavePoints(WS)).points[0];
    const d = await diffSavePoint(WS, hash);
    expect(d.ok).toBe(true);
    const a = d.files.find((f) => f.path === "a.txt")!;
    expect(a.status).toBe("modified");
    expect(a.old).toBe("old content\n");
    expect(a.new).toBe("new content\n");
    expect(d.files.find((f) => f.path === "b.txt")!.status).toBe("added");
  });

  it("restore roundtrip: reverts edits, removes new files, keeps excluded, is undoable", async () => {
    writeFileSync(join(WS, "a.txt"), "v1");
    await snapshotBeforeTurn(WS, "punto uno", "t1");
    const target = (await listSavePoints(WS)).points[0].hash;

    writeFileSync(join(WS, "a.txt"), "v2");
    writeFileSync(join(WS, "later.txt"), "made after");
    mkdirSync(join(WS, "node_modules"), { recursive: true });
    writeFileSync(join(WS, "node_modules", "dep.js"), "x");

    const r = await restoreSavePoint(WS, target, { safety: "Safety point", restored: "Went back" });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(WS, "a.txt"), "utf8")).toBe("v1");
    expect(existsSync(join(WS, "later.txt"))).toBe(false);
    expect(existsSync(join(WS, "node_modules", "dep.js"))).toBe(true);
    expect(existsSync(join(WS, ".git"))).toBe(false);

    // Safety point recorded → the restore is undoable: go back to it.
    const points = (await listSavePoints(WS)).points;
    expect(points.length).toBeGreaterThanOrEqual(3);
    const safety = points.find((p) => p.label === "Safety point")!;
    const undo = await restoreSavePoint(WS, safety.hash, { safety: "Safety 2", restored: "Forward again" });
    expect(undo.ok).toBe(true);
    expect(readFileSync(join(WS, "a.txt"), "utf8")).toBe("v2");
    expect(readFileSync(join(WS, "later.txt"), "utf8")).toBe("made after");
  });

  it("leaves a project's own real git repo untouched", async () => {
    await runGit(["init", "-b", "main"], { cwd: WS });
    writeFileSync(join(WS, "f.txt"), "1");
    await runGit(["add", "-A"], { cwd: WS });
    await runGit(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "own"], { cwd: WS });
    const headBefore = (await runGit(["rev-parse", "HEAD"], { cwd: WS })).stdout.trim();

    await snapshotBeforeTurn(WS, "p", "t1");
    writeFileSync(join(WS, "f.txt"), "2");
    const target = (await listSavePoints(WS)).points[0].hash;
    await restoreSavePoint(WS, target, { safety: "s", restored: "r" });

    expect(readFileSync(join(WS, "f.txt"), "utf8")).toBe("1");
    const headAfter = (await runGit(["rev-parse", "HEAD"], { cwd: WS })).stdout.trim();
    expect(headAfter).toBe(headBefore);
    expect(existsSync(join(WS, ".git"))).toBe(true);
  });
});
