import { describe, it, expect } from "vitest";
import { autoAllows } from "@/server/safety-presets";

describe("autoAllows", () => {
  it("never auto-allows blocked or red levels", () => {
    expect(autoAllows("block", "mcp", "mcp__x__y", "open")).toBe(false);
    expect(autoAllows("red", "network", "WebFetch", "open")).toBe(false);
  });

  it("open behavior auto-allows any normal-level tool, MCP included", () => {
    expect(autoAllows("normal", "mcp", "mcp__memory__read_graph", "open")).toBe(true);
    expect(autoAllows("normal", "none", "Bash", "open")).toBe(true);
  });

  it("MCP always prompts under ask and auto behaviors", () => {
    expect(autoAllows("normal", "mcp", "mcp__memory__read_graph", "ask")).toBe(false);
    expect(autoAllows("normal", "mcp", "mcp__memory__read_graph", "auto")).toBe(false);
  });

  it("read-only tools auto-allow under ask/auto; writes do not", () => {
    expect(autoAllows("normal", "none", "Read", "ask")).toBe(true);
    expect(autoAllows("normal", "none", "Grep", "auto")).toBe(true);
    expect(autoAllows("normal", "none", "Bash", "auto")).toBe(false);
    expect(autoAllows("normal", "none", "Write", "ask")).toBe(false);
  });
});
