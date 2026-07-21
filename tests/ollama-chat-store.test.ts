import { describe, it, expect, vi, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { homedir } from "node:os";

// Redirect homedir() so the store writes inside a throwaway directory (the
// factory is hoisted above imports, so the temp dir is created inside it).
vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(os.tmpdir(), "ccw-ollama-"));
  return { ...os, homedir: () => home };
});

import { loadChat, saveChat } from "@/server/providers/ollama/chat-store";

afterAll(() => {
  rmSync(homedir(), { recursive: true, force: true });
});

describe("ollama chat store", () => {
  it("round-trips a conversation", () => {
    const sid = "123e4567-e89b-42d3-a456-426614174000";
    saveChat(sid, { model: "qwen2.5:latest", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] });
    const chat = loadChat(sid);
    expect(chat.model).toBe("qwen2.5:latest");
    expect(chat.messages).toHaveLength(2);
    expect(chat.messages[1]).toEqual({ role: "assistant", content: "hello" });
  });

  it("returns an empty history for unknown sessions", () => {
    expect(loadChat("00000000-0000-4000-8000-000000000000").messages).toEqual([]);
  });

  it("rejects path-like session ids instead of touching the filesystem", () => {
    expect(() => saveChat("../../etc/passwd", { messages: [] })).not.toThrow();
    expect(loadChat("../../etc/passwd").messages).toEqual([]);
    expect(loadChat("a/b").messages).toEqual([]);
  });
});
