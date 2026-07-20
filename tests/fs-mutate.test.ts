import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, symlinkSync, readFileSync } from "node:fs";
import {
  writeFileInProject,
  createFileInProject,
  renameEntry,
  moveEntry,
  deleteEntry,
  searchFiles,
} from "@/server/fs-mutate";

const ROOT = join(homedir(), "easyagent");
const WS = join(ROOT, "fs-mutate-test");

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });
});
afterAll(() => {
  rmSync(WS, { recursive: true, force: true });
  rmSync(join(homedir(), "easyagent-mutate-escape"), { recursive: true, force: true });
});

describe("write/create confinement", () => {
  it("writes a file inside the project", () => {
    const r = writeFileInProject(join(WS, "hello.txt"), "hi");
    expect(r.ok).toBe(true);
    expect(readFileSync(join(WS, "hello.txt"), "utf8")).toBe("hi");
  });

  it("rejects writing outside the projects root", () => {
    expect(writeFileInProject(join(homedir(), "escape.txt"), "x").ok).toBe(false);
    expect(writeFileInProject("/etc/evil.conf", "x").ok).toBe(false);
  });

  it("rejects traversal and separator names", () => {
    expect(writeFileInProject(join(WS, "..", "..", "escape.txt"), "x").ok).toBe(false);
    expect(createFileInProject(WS, "../evil").ok).toBe(false);
    expect(createFileInProject(WS, "a/b").ok).toBe(false);
    expect(createFileInProject(WS, "..").ok).toBe(false);
  });

  it("rejects a write whose parent is a symlink escaping the root", () => {
    const outside = join(homedir(), "easyagent-mutate-escape");
    mkdirSync(outside, { recursive: true });
    const link = join(WS, "link");
    if (existsSync(link)) rmSync(link);
    symlinkSync(outside, link);
    expect(writeFileInProject(join(link, "pwn.txt"), "x").ok).toBe(false);
  });

  it("allows dotfiles (creating .env is not a secret READ)", () => {
    expect(createFileInProject(WS, ".env").ok).toBe(true);
  });

  it("createFile refuses to overwrite", () => {
    expect(createFileInProject(WS, "a.txt").ok).toBe(true);
    expect(createFileInProject(WS, "a.txt").ok).toBe(false);
  });
});

describe("rename / move / delete", () => {
  it("renames within the same folder", () => {
    writeFileInProject(join(WS, "a.txt"), "1");
    const r = renameEntry(join(WS, "a.txt"), "b.txt");
    expect(r.ok).toBe(true);
    expect(existsSync(join(WS, "b.txt"))).toBe(true);
    expect(existsSync(join(WS, "a.txt"))).toBe(false);
  });

  it("refuses rename to an existing name", () => {
    writeFileInProject(join(WS, "a.txt"), "1");
    writeFileInProject(join(WS, "b.txt"), "2");
    expect(renameEntry(join(WS, "a.txt"), "b.txt").ok).toBe(false);
  });

  it("moves a file into a subfolder", () => {
    writeFileInProject(join(WS, "a.txt"), "1");
    mkdirSync(join(WS, "sub"));
    const r = moveEntry(join(WS, "a.txt"), join(WS, "sub"));
    expect(r.ok).toBe(true);
    expect(existsSync(join(WS, "sub", "a.txt"))).toBe(true);
  });

  it("refuses moving a folder into its own descendant", () => {
    mkdirSync(join(WS, "d", "inner"), { recursive: true });
    expect(moveEntry(join(WS, "d"), join(WS, "d", "inner")).ok).toBe(false);
  });

  it("refuses move to a destination outside the root", () => {
    writeFileInProject(join(WS, "a.txt"), "1");
    expect(moveEntry(join(WS, "a.txt"), homedir()).ok).toBe(false);
  });

  it("soft-deletes to trash (recoverable) and refuses deleting the root", () => {
    writeFileInProject(join(WS, "gone.txt"), "1");
    const r = deleteEntry(join(WS, "gone.txt"));
    expect(r.ok).toBe(true);
    expect(existsSync(join(WS, "gone.txt"))).toBe(false);
    expect(r.path && existsSync(r.path)).toBe(true); // still in trash
    expect(deleteEntry(ROOT).ok).toBe(false);
  });
});

describe("search", () => {
  it("finds files by name and by content, confined to the subtree", () => {
    writeFileInProject(join(WS, "needle-name.txt"), "nothing here");
    writeFileInProject(join(WS, "other.txt"), "a special MARKER inside");
    const r = searchFiles(WS, "MARKER");
    expect(r.ok).toBe(true);
    expect(r.hits!.some((h) => h.name === "other.txt" && h.line)).toBe(true);
    const byName = searchFiles(WS, "needle");
    expect(byName.hits!.some((h) => h.name === "needle-name.txt")).toBe(true);
  });

  it("rejects a root outside the projects root", () => {
    expect(searchFiles(homedir(), "x").ok).toBe(false);
  });
});
