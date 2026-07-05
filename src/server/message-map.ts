/* eslint-disable @typescript-eslint/no-explicit-any */

// Maps stored Claude Code session messages (getSessionMessages) into the store's
// transcript Item shape, mirroring the live stream mapping in agent-runner.ts.

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === "text" ? b.text : typeof b === "string" ? b : "")).join("\n");
  }
  return "";
}

export function mapSessionMessages(messages: any[]): any[] {
  const items: any[] = [];
  const toolIndex: Record<string, number> = {};
  let counter = 0;
  const nid = () => `h${counter++}`;

  for (const m of messages) {
    const msg = m?.message;
    if (m?.type === "assistant") {
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "text" && b.text) items.push({ kind: "assistant", id: nid(), text: b.text });
          else if (b.type === "thinking" && b.thinking) items.push({ kind: "thinking", id: nid(), text: b.thinking });
          else if (b.type === "tool_use") {
            toolIndex[b.id] = items.length;
            items.push({ kind: "tool", id: b.id, name: b.name, input: b.input ?? {}, status: "done" });
          }
        }
      } else if (typeof content === "string" && content) {
        items.push({ kind: "assistant", id: nid(), text: content });
      }
    } else if (m?.type === "user") {
      const content = msg?.content;
      if (typeof content === "string") {
        if (content) items.push({ kind: "user", id: nid(), text: content });
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "text" && b.text) items.push({ kind: "user", id: nid(), text: b.text });
          else if (b.type === "tool_result") {
            const idx = toolIndex[b.tool_use_id];
            if (idx !== undefined) {
              items[idx] = { ...items[idx], result: toolResultText(b.content), isError: !!b.is_error };
            }
          }
        }
      }
    }
    // system messages are skipped
  }
  return items;
}
