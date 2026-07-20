import { describe, it, expect } from "vitest";
import { parseMcpTool } from "@/lib/mcp-shared";

describe("parseMcpTool", () => {
  it("parses server and tool", () => {
    expect(parseMcpTool("mcp__github__create_issue")).toEqual({ server: "github", tool: "create_issue" });
  });
  it("splits at the FIRST __ so tools may contain __", () => {
    expect(parseMcpTool("mcp__srv__a__b")).toEqual({ server: "srv", tool: "a__b" });
  });
  it("returns null for non-MCP names and malformed strings", () => {
    expect(parseMcpTool("Bash")).toBeNull();
    expect(parseMcpTool("mcp__onlyserver")).toBeNull();
    expect(parseMcpTool("mcp____tool")).toBeNull();
  });
});
