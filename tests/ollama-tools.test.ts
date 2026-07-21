import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { resolveInProject, execProjectTool, toolDisplay } from "@/server/providers/ollama/runner";

// The Ollama tool loop executes file tools server-side, confined to the
// project folder (same conventions as the fs-mutate suite).

const ROOT = join(homedir(), "easyagent");
const WS = join(ROOT, "ollama-tools-test");

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(join(WS, "src"), { recursive: true });
  writeFileSync(join(WS, "src", "a.txt"), "alpha", "utf8");
});
afterAll(() => {
  rmSync(WS, { recursive: true, force: true });
});

describe("resolveInProject", () => {
  it("resolves relative paths inside the project", () => {
    expect(resolveInProject(WS, "src/a.txt")).toBe(join(WS, "src", "a.txt"));
    expect(resolveInProject(WS, ".")).toBe(WS);
    expect(resolveInProject(WS, "")).toBe(WS);
    expect(resolveInProject(WS, "/leading/slash")).toBe(join(WS, "leading", "slash"));
  });

  it("rejects traversal outside the project", () => {
    expect(resolveInProject(WS, "../other-project/file")).toBeNull();
    expect(resolveInProject(WS, "src/../../escape")).toBeNull();
    expect(resolveInProject(WS, 42 as unknown as string)).toBeNull();
  });
});

describe("execProjectTool", () => {
  it("lists, reads and writes inside the project", () => {
    const ls = execProjectTool(WS, "list_files", { path: "." });
    expect(ls.isError).toBe(false);
    expect(ls.content).toContain("src/");

    const read = execProjectTool(WS, "read_file", { path: "src/a.txt" });
    expect(read).toEqual({ content: "alpha", isError: false });

    const write = execProjectTool(WS, "write_file", { path: "docs/new.md", content: "# hi" });
    expect(write.isError).toBe(false);
    expect(readFileSync(join(WS, "docs", "new.md"), "utf8")).toBe("# hi"); // parents auto-created
  });

  it("fails closed on escapes, unknown tools and bad input", () => {
    expect(execProjectTool(WS, "write_file", { path: "../evil.txt", content: "x" }).isError).toBe(true);
    expect(execProjectTool(WS, "read_file", { path: "missing.txt" }).isError).toBe(true);
    expect(execProjectTool(WS, "write_file", { path: "ok.txt" }).isError).toBe(true); // no content
    expect(execProjectTool(WS, "self_destruct", { path: "." }).isError).toBe(true);
  });
});

describe("toolDisplay", () => {
  it("mirrors the transcript names the UI already renders", () => {
    expect(toolDisplay(WS, "read_file", { path: "src/a.txt" })).toEqual({ name: "Read", input: { file_path: "src/a.txt" } });
    expect(toolDisplay(WS, "write_file", { path: "b.txt", content: "x" })).toEqual({
      name: "Write",
      input: { file_path: "b.txt", content: "x" },
    });
    expect(toolDisplay(WS, "list_files", { path: "." })).toEqual({ name: "LS", input: { path: "." } });
  });
});
