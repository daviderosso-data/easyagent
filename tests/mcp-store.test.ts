import { describe, it, expect } from "vitest";
import { validateEntry, buildMcpConfig, entryFromPreset, type McpEntry } from "@/server/mcp-store";

// Pure-function tests only — the real ~/.easyclaude/mcp.json is never touched.

const base = (over: Partial<McpEntry> = {}): McpEntry => ({
  id: "x1",
  name: "memory",
  kind: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-memory"],
  enabled: true,
  ...over,
});

describe("validateEntry", () => {
  it("accepts a valid stdio entry", () => {
    const r = validateEntry({ name: "tools", kind: "stdio", command: "npx", args: ["-y", "pkg"] }, []);
    expect(r.ok).toBe(true);
    expect(r.entry!.name).toBe("tools");
  });

  it("rejects bad names (uppercase, spaces, too long, leading dash)", () => {
    for (const name of ["Tools", "my server", "a".repeat(33), "-x", ""]) {
      expect(validateEntry({ name, kind: "stdio", command: "x" }, []).error).toBe("bad-name");
    }
  });

  it("rejects duplicates case-insensitively, but allows self-update", () => {
    const existing = [base({ id: "a1", name: "github" })];
    expect(validateEntry({ name: "GITHUB".toLowerCase(), kind: "http", url: "https://x.y" }, existing).ok).toBe(false);
    expect(validateEntry({ name: "github", kind: "http", url: "https://x.y" }, existing, "a1").ok).toBe(true);
  });

  it("enforces kind↔field coherence and caps", () => {
    expect(validateEntry({ name: "a", kind: "stdio" }, []).error).toBe("bad-fields");
    expect(validateEntry({ name: "a", kind: "http" }, []).error).toBe("bad-fields");
    expect(validateEntry({ name: "a", kind: "http", url: "ftp://x" }, []).error).toBe("bad-fields");
    expect(validateEntry({ name: "a", kind: "stdio", command: "x", args: Array(25).fill("y") }, []).error).toBe("bad-fields");
    expect(validateEntry({ name: "a", kind: "stdio", command: "x", env: { "1BAD": "v" } }, []).error).toBe("bad-fields");
    expect(validateEntry({ name: "a", kind: "weird", command: "x" }, []).error).toBe("bad-fields");
  });
});

describe("buildMcpConfig", () => {
  it("includes only enabled entries with the right SDK shapes", () => {
    const cfg = buildMcpConfig([
      base(),
      base({ id: "x2", name: "gh", kind: "http", command: undefined, args: undefined, url: "https://api.example/mcp/", headers: { Authorization: "Bearer t" } }),
      base({ id: "x3", name: "off", enabled: false }),
    ]);
    expect(Object.keys(cfg).sort()).toEqual(["gh", "memory"]);
    expect(cfg.memory).toEqual({ type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] });
    expect(cfg.gh).toEqual({ type: "http", url: "https://api.example/mcp/", headers: { Authorization: "Bearer t" } });
  });

  it("is empty when everything is disabled", () => {
    expect(buildMcpConfig([base({ enabled: false })])).toEqual({});
  });
});

describe("entryFromPreset", () => {
  it("builds the github preset with a Bearer token header", () => {
    const e = entryFromPreset("github", " tok123 ");
    expect(e!.kind).toBe("http");
    expect(e!.headers).toEqual({ Authorization: "Bearer tok123" });
  });

  it("refuses github without a token; unknown preset → null", () => {
    expect(entryFromPreset("github")).toBeNull();
    expect(entryFromPreset("nope")).toBeNull();
  });

  it("builds keyless presets directly", () => {
    expect(entryFromPreset("memory")!.command).toBe("npx");
    expect(entryFromPreset("filesystem")!.args!.length).toBeGreaterThan(1);
  });
});
