import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { orchestrationGrants } from "@/server/orchestration-grants";

const ROOT = join(homedir(), "easyagent", "grant-test");

describe("orchestration grants", () => {
  it("mints a grant valid for its project root and subfolders", () => {
    mkdirSync(join(ROOT, "sub"), { recursive: true });
    const id = orchestrationGrants.mint(ROOT);
    expect(orchestrationGrants.validFor(id, ROOT)).toBe(true);
    expect(orchestrationGrants.validFor(id, join(ROOT, "sub"))).toBe(true);
  });

  it("rejects a different project root", () => {
    mkdirSync(ROOT, { recursive: true });
    const id = orchestrationGrants.mint(ROOT);
    expect(orchestrationGrants.validFor(id, join(homedir(), "easyagent"))).toBe(false);
    // A sibling that merely shares a name prefix must not match.
    expect(orchestrationGrants.validFor(id, ROOT + "-evil")).toBe(false);
  });

  it("rejects unknown / malformed grant ids", () => {
    expect(orchestrationGrants.validFor("does-not-exist", ROOT)).toBe(false);
    expect(orchestrationGrants.validFor("", ROOT)).toBe(false);
    expect(orchestrationGrants.validFor(undefined, ROOT)).toBe(false);
    expect(orchestrationGrants.validFor(42, ROOT)).toBe(false);
  });
});
