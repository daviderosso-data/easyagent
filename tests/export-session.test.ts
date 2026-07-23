import { describe, expect, test } from "vitest";
import { escapeHtml, sessionToHtml, sessionToMarkdown } from "@/lib/export-session";
import type { Item } from "@/store/agent";

const meta = {
  project: "demo",
  engine: "Claude Code",
  model: "Default",
  date: "2026-07-23",
  labels: { you: "You", assistant: "Assistant", tool: "Action", cost: "Cost" },
};

const items: Item[] = [
  { kind: "user", id: "1", text: "add a title" },
  {
    kind: "tool",
    id: "2",
    name: "Edit",
    input: { file_path: "index.html", old_string: "<h1>old</h1>", new_string: "<h1>new</h1>" },
    status: "done",
  },
  { kind: "assistant", id: "3", text: "Done, title added." },
  { kind: "error", id: "4", message: "boom" },
  { kind: "done", id: "5", costUsd: 0.42, numTurns: 1, durationMs: 1000, isError: false },
];

describe("sessionToMarkdown", () => {
  test("keeps text, file changes and errors", () => {
    const md = sessionToMarkdown(items, meta);
    expect(md).toContain("# demo");
    expect(md).toContain("## You");
    expect(md).toContain("add a title");
    expect(md).toContain("`index.html`");
    expect(md).toContain("<h1>old</h1>");
    expect(md).toContain("<h1>new</h1>");
    expect(md).toContain("Done, title added.");
    expect(md).toContain("> ⚠ boom");
    expect(md).toContain("~$0.42");
  });
});

describe("sessionToHtml", () => {
  test("escapes markup and is self-contained", () => {
    const html = sessionToHtml(items, meta);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("&lt;h1&gt;old&lt;/h1&gt;");
    expect(html).not.toContain("<h1>old</h1>");
    expect(html).toContain("Done, title added.");
  });

  test("escapeHtml covers the four dangerous characters", () => {
    expect(escapeHtml(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });
});
