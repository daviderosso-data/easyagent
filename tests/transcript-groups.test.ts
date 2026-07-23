import { describe, expect, test } from "vitest";
import { GROUP_MIN, groupTranscript } from "@/lib/transcript-groups";
import type { Item } from "@/store/agent";

let n = 0;
const tool = (status: "running" | "done" = "done", isError = false): Item => ({
  kind: "tool",
  id: `t${n++}`,
  name: "Read",
  input: {},
  status,
  isError,
});
const text = (): Item => ({ kind: "assistant", id: `a${n++}`, text: "hi" });

describe("groupTranscript", () => {
  test("short runs stay as individual items", () => {
    const items = [text(), ...Array.from({ length: GROUP_MIN - 1 }, () => tool())];
    const blocks = groupTranscript(items);
    expect(blocks).toHaveLength(items.length);
    expect(blocks.every((b) => b.kind === "item")).toBe(true);
  });

  test("long runs of completed tools collapse into one group", () => {
    const run = Array.from({ length: GROUP_MIN + 2 }, () => tool());
    const blocks = groupTranscript([text(), ...run, text()]);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatchObject({ kind: "group" });
    if (blocks[1].kind === "group") expect(blocks[1].items).toHaveLength(run.length);
  });

  test("a running tool never joins a group", () => {
    const done = Array.from({ length: GROUP_MIN }, () => tool());
    const running = tool("running");
    const blocks = groupTranscript([...done, running]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe("group");
    expect(blocks[1]).toMatchObject({ kind: "item", item: running });
  });

  test("non-tool items break the run", () => {
    const blocks = groupTranscript([tool(), tool(), text(), tool(), tool()]);
    expect(blocks.every((b) => b.kind === "item")).toBe(true);
    expect(blocks).toHaveLength(5);
  });

  test("group keys are stable (first tool id)", () => {
    const run = Array.from({ length: GROUP_MIN }, () => tool());
    const [block] = groupTranscript(run);
    expect(block).toMatchObject({ kind: "group", key: run[0].id });
  });
});
