// P6.9.7 — turn a session transcript into a self-contained Markdown or HTML
// document, file changes included. Pure functions so they are unit-testable.

import type { Item } from "@/store/agent";

export interface ExportMeta {
  /** Project folder name shown in the title. */
  project: string;
  engine: string;
  model: string;
  date: string;
  labels: { you: string; assistant: string; tool: string; cost: string };
}

const MAX_BLOCK = 4000;

function clip(s: string): string {
  return s.length > MAX_BLOCK ? s.slice(0, MAX_BLOCK) + "\n…" : s;
}

/** The pieces of a tool call worth keeping in an export: the file it touched
 *  and what changed (Write content, Edit old/new, run commands). */
function toolBlocks(input: Record<string, unknown>): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  const path = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : null;
  if (path) out.push({ label: "file", text: path });
  if (typeof input.command === "string") out.push({ label: "command", text: clip(input.command) });
  if (typeof input.content === "string") out.push({ label: "content", text: clip(input.content) });
  if (typeof input.old_string === "string") out.push({ label: "before", text: clip(input.old_string) });
  if (typeof input.new_string === "string") out.push({ label: "after", text: clip(input.new_string) });
  return out;
}

export function sessionToMarkdown(items: Item[], meta: ExportMeta): string {
  const lines: string[] = [
    `# ${meta.project}`,
    "",
    `${meta.date} · ${meta.engine} · ${meta.model}`,
    "",
  ];
  for (const it of items) {
    if (it.kind === "user") lines.push(`## ${meta.labels.you}`, "", it.text, "");
    else if (it.kind === "assistant") lines.push(`## ${meta.labels.assistant}`, "", it.text, "");
    else if (it.kind === "tool") {
      lines.push(`**${meta.labels.tool}: ${it.name}**${it.isError ? " ⚠" : ""}`, "");
      for (const b of toolBlocks(it.input)) {
        if (b.label === "file") lines.push(`\`${b.text}\``, "");
        else lines.push("```", b.text, "```", "");
      }
    } else if (it.kind === "error") lines.push(`> ⚠ ${it.message}`, "");
    else if (it.kind === "done" && it.costUsd > 0) lines.push(`_${meta.labels.cost} ~$${it.costUsd.toFixed(2)}_`, "");
  }
  return lines.join("\n");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sessionToHtml(items: Item[], meta: ExportMeta): string {
  const body: string[] = [
    `<h1>${escapeHtml(meta.project)}</h1>`,
    `<p class="meta">${escapeHtml(`${meta.date} · ${meta.engine} · ${meta.model}`)}</p>`,
  ];
  for (const it of items) {
    if (it.kind === "user") body.push(`<h2>${escapeHtml(meta.labels.you)}</h2><p>${escapeHtml(it.text).replace(/\n/g, "<br>")}</p>`);
    else if (it.kind === "assistant") body.push(`<h2>${escapeHtml(meta.labels.assistant)}</h2><p>${escapeHtml(it.text).replace(/\n/g, "<br>")}</p>`);
    else if (it.kind === "tool") {
      body.push(`<p class="tool"><b>${escapeHtml(meta.labels.tool)}: ${escapeHtml(it.name)}</b>${it.isError ? " ⚠" : ""}</p>`);
      for (const b of toolBlocks(it.input)) {
        if (b.label === "file") body.push(`<p><code>${escapeHtml(b.text)}</code></p>`);
        else body.push(`<pre>${escapeHtml(b.text)}</pre>`);
      }
    } else if (it.kind === "error") body.push(`<blockquote>⚠ ${escapeHtml(it.message)}</blockquote>`);
    else if (it.kind === "done" && it.costUsd > 0) body.push(`<p class="meta">${escapeHtml(meta.labels.cost)} ~$${it.costUsd.toFixed(2)}</p>`);
  }
  return [
    "<!doctype html>",
    `<html><head><meta charset="utf-8"><title>${escapeHtml(meta.project)}</title><style>`,
    "body{font-family:-apple-system,system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.5}",
    "h1{font-size:1.4rem}h2{font-size:1rem;margin:1.4em 0 .3em;color:#555}",
    "pre{background:#f6f6f6;border:1px solid #e2e2e2;border-radius:6px;padding:10px;overflow-x:auto;font-size:12px}",
    "code{background:#f6f6f6;padding:1px 5px;border-radius:4px;font-size:12px}",
    "blockquote{border-left:3px solid #c0392b;margin:0;padding:2px 10px;color:#c0392b}",
    ".meta{color:#888;font-size:12px}.tool{margin-bottom:4px}",
    "@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#eee}pre,code{background:#161616;border-color:#2a2a2a}h2{color:#aaa}}",
    "</style></head><body>",
    ...body,
    "</body></html>",
  ].join("\n");
}
