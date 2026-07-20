import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { migrateLegacyData } from "@/server/migrate-legacy";

// A fake home dir keeps the real ~/.easyagent and ~/easyagent untouched.
const HOME = join(tmpdir(), "easyagent-migrate-test");
const sha8 = (p: string) => createHash("sha1").update(p).digest("hex").slice(0, 8);

beforeEach(() => {
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
});
afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
});

describe("migrateLegacyData", () => {
  it("renames both legacy dirs and rewrites embedded paths in the JSON stores", () => {
    mkdirSync(join(HOME, "easyclaude", "demo"), { recursive: true });
    mkdirSync(join(HOME, ".easyclaude"), { recursive: true });
    writeFileSync(
      join(HOME, ".easyclaude", "workspace.json"),
      JSON.stringify({ panels: [{ projectPath: join(HOME, "easyclaude", "demo") }] })
    );
    writeFileSync(
      join(HOME, ".easyclaude", "mcp.json"),
      JSON.stringify({ v: 1, servers: [{ env: { MEMORY_FILE_PATH: join(HOME, ".easyclaude", "memory.json") } }] })
    );

    migrateLegacyData(HOME);

    expect(existsSync(join(HOME, "easyagent", "demo"))).toBe(true);
    expect(existsSync(join(HOME, "easyclaude"))).toBe(false);
    expect(existsSync(join(HOME, ".easyclaude"))).toBe(false);
    const ws = readFileSync(join(HOME, ".easyagent", "workspace.json"), "utf8");
    expect(ws).toContain(join(HOME, "easyagent", "demo"));
    expect(ws).not.toContain("easyclaude");
    const mcp = readFileSync(join(HOME, ".easyagent", "mcp.json"), "utf8");
    expect(mcp).toContain(join(HOME, ".easyagent", "memory.json"));
  });

  it("re-hashes save-point shadow repos so project history survives", () => {
    const oldRoot = join(HOME, "easyclaude", "demo-sito");
    const newRoot = join(HOME, "easyagent", "demo-sito");
    mkdirSync(oldRoot, { recursive: true });
    const snapName = `demo-sito-${sha8(oldRoot)}.git`;
    mkdirSync(join(HOME, ".easyclaude", "snapshots", snapName), { recursive: true });
    writeFileSync(join(HOME, ".easyclaude", "snapshots", snapName, "HEAD"), "ref: refs/heads/main\n");

    migrateLegacyData(HOME);

    const expected = join(HOME, ".easyagent", "snapshots", `demo-sito-${sha8(newRoot)}.git`);
    expect(existsSync(expected)).toBe(true);
    expect(readFileSync(join(expected, "HEAD"), "utf8")).toContain("main");
  });

  it("is a no-op on a fresh machine and never clobbers existing new dirs", () => {
    expect(() => migrateLegacyData(HOME)).not.toThrow();

    mkdirSync(join(HOME, "easyagent"), { recursive: true });
    writeFileSync(join(HOME, "easyagent", "keep.txt"), "new");
    mkdirSync(join(HOME, "easyclaude"), { recursive: true });
    writeFileSync(join(HOME, "easyclaude", "old.txt"), "old");
    migrateLegacyData(HOME);
    expect(readFileSync(join(HOME, "easyagent", "keep.txt"), "utf8")).toBe("new");
    expect(existsSync(join(HOME, "easyclaude", "old.txt"))).toBe(true);
  });
});
