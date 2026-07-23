import type { Item } from "@/store/agent";

export type ToolItem = Extract<Item, { kind: "tool" }>;

export type TranscriptBlock =
  | { kind: "item"; item: Item }
  | { kind: "group"; items: ToolItem[]; key: string };

/** Runs of completed tool steps this long (or longer) collapse into one group. */
export const GROUP_MIN = 3;

/** Folds consecutive completed tool calls into collapsible groups so long
 *  turns stay readable. A still-running tool never joins a group — current
 *  activity must stay visible while the agent works. */
export function groupTranscript(items: Item[]): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  let run: ToolItem[] = [];

  const flush = () => {
    if (run.length >= GROUP_MIN) out.push({ kind: "group", items: run, key: run[0].id });
    else for (const item of run) out.push({ kind: "item", item });
    run = [];
  };

  for (const it of items) {
    if (it.kind === "tool" && it.status === "done") {
      run.push(it);
    } else {
      flush();
      out.push({ kind: "item", item: it });
    }
  }
  flush();
  return out;
}
