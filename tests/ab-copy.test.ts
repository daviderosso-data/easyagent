import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createAbCopy } from "@/server/ab-copy";

const ROOT = join(homedir(), "easyagent");
const WS = join(ROOT, "ab-copy-test");

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(join(WS, "src"), { recursive: true });
  mkdirSync(join(WS, "node_modules", "x"), { recursive: true });
  writeFileSync(join(WS, "index.html"), "<h1>hi</h1>");
  writeFileSync(join(WS, "src", "app.js"), "console.log(1)");
});
afterAll(() => rmSync(WS, { recursive: true, force: true }));

describe("createAbCopy", () => {
  it("copies project files into ab-<engine> without heavy folders", () => {
    const r = createAbCopy(WS, "codex");
    expect(r.ok).toBe(true);
    expect(r.path).toBe(join(WS, "ab-codex"));
    expect(readFileSync(join(WS, "ab-codex", "index.html"), "utf8")).toBe("<h1>hi</h1>");
    expect(readFileSync(join(WS, "ab-codex", "src", "app.js"), "utf8")).toBe("console.log(1)");
    expect(existsSync(join(WS, "ab-codex", "node_modules"))).toBe(false);
  });

  it("never copies an existing ab-* folder into a new copy, and dedupes names", () => {
    const first = createAbCopy(WS, "codex");
    expect(first.ok).toBe(true);
    const second = createAbCopy(WS, "codex");
    expect(second.ok).toBe(true);
    expect(second.path).toBe(join(WS, "ab-codex-2"));
    expect(existsSync(join(WS, "ab-codex-2", "ab-codex"))).toBe(false);
  });

  it("works from a subfolder cwd (copies from the project root)", () => {
    const r = createAbCopy(join(WS, "src"), "grok");
    expect(r.ok).toBe(true);
    expect(r.path).toBe(join(WS, "ab-grok"));
    expect(existsSync(join(WS, "ab-grok", "index.html"))).toBe(true);
  });

  it("refuses paths outside the projects root", () => {
    expect(createAbCopy("/tmp", "x").ok).toBe(false);
  });
});
