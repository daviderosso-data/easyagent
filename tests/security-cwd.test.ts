import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { validateCwd } from "@/server/security";

const ROOT = join(homedir(), "easyagent");
const REAL = join(ROOT, "cwd-test-real");
const OUTSIDE = join(homedir(), "easyagent-cwd-escape-target");
const LINK = join(ROOT, "cwd-test-link");

beforeAll(() => {
  mkdirSync(REAL, { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
  if (existsSync(LINK)) rmSync(LINK);
  symlinkSync(OUTSIDE, LINK);
});

afterAll(() => {
  for (const p of [REAL, LINK]) {
    try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  try { rmSync(OUTSIDE, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("validateCwd confinement", () => {
  it("accepts a real folder inside the projects root", () => {
    const r = validateCwd(REAL);
    expect(r.ok).toBe(true);
  });

  it("rejects a symlink inside the root that points outside it", () => {
    const r = validateCwd(LINK);
    expect(r.ok).toBe(false);
  });

  it("rejects a path outside the projects root", () => {
    expect(validateCwd("/etc").ok).toBe(false);
    expect(validateCwd(join(homedir(), "Desktop")).ok).toBe(false);
  });

  it("rejects empty / non-string input", () => {
    expect(validateCwd("").ok).toBe(false);
    expect(validateCwd(undefined).ok).toBe(false);
    expect(validateCwd(123).ok).toBe(false);
  });
});
