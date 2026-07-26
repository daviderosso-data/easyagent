// Ollama engine: local models over the daemon's HTTP API (streaming NDJSON),
// now with an easyagent-driven tool loop so local models can explore and
// modify project files like the other engines. Tools are executed here,
// confined to the project folder (fs-browse/fs-mutate are symlink-safe and
// scoped to the projects root); writes go through the approval flow when the
// security config asks for confirmation. Conversation history lives in
// chat-store.ts because the daemon is stateless.

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { AgentEvent } from "@/lib/agent-events";
import { genericError } from "@/server/i18n-server";
import { listDir, readFileSafe } from "@/server/fs-browse";
import { writeFileInProject } from "@/server/fs-mutate";
import type { EngineStatus, ProviderModel, TurnRequest } from "@/server/providers/types";
import { loadChat, saveChat, type ChatMessage, type ToolCall } from "@/server/providers/ollama/chat-store";

export const OLLAMA_URL = process.env.EASYAGENT_OLLAMA_URL || "http://127.0.0.1:11434";

/** Tool rounds per turn — a hard stop so a looping local model can't spin forever. */
const MAX_ROUNDS = 12;

export async function ollamaStatus(): Promise<EngineStatus> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(1500) });
    return { installed: r.ok, loggedIn: null };
  } catch {
    return { installed: false, loggedIn: null };
  }
}

interface TagsResponse {
  models?: { name?: string }[];
}

async function installedModels(): Promise<string[]> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as TagsResponse;
    return (j.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

export async function ollamaModels(): Promise<ProviderModel[]> {
  const names = await installedModels();
  return [{ id: null, label: "Default" }, ...names.map((n) => ({ id: n, label: n }))];
}

/* ---- project-confined tools ---- */

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and folders at a path inside the project. Use '.' for the project root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Folder path relative to the project root" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file inside the project (path relative to the project root).",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a text file inside the project (path relative to the project root). Parent folders are created automatically.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
];

/** Resolve a model-supplied relative path strictly inside the project folder. */
export function resolveInProject(cwd: string, rel: unknown): string | null {
  if (typeof rel !== "string" || rel.includes("\x00")) return null;
  const cleaned = rel.trim().replace(/^\/+/, "");
  const abs = resolve(cwd, cleaned === "" ? "." : cleaned);
  if (abs !== cwd && !abs.startsWith(cwd + sep)) return null;
  return abs;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

/** Execute one tool call (paths already confined; fs modules re-validate). */
export function execProjectTool(cwd: string, name: string, args: Record<string, unknown>): ToolOutcome {
  const abs = resolveInProject(cwd, args.path);
  if (!abs) return { content: "Invalid path: it must stay inside the project folder.", isError: true };
  const rel = relative(cwd, abs) || ".";

  if (name === "list_files") {
    const r = listDir(abs);
    if (!r.ok || !r.entries) return { content: `Cannot list "${rel}".`, isError: true };
    const lines = r.entries.map((e) => (e.isDir ? `${e.name}/` : e.name));
    return { content: lines.length ? lines.join("\n") : "(empty folder)", isError: false };
  }
  if (name === "read_file") {
    const r = readFileSafe(abs);
    if (!r.ok) return { content: `Cannot read "${rel}".`, isError: true };
    if (r.binary) return { content: `"${rel}" is a binary file.`, isError: true };
    if (r.tooBig) return { content: `"${rel}" is too large to read.`, isError: true };
    return { content: r.content ?? "", isError: false };
  }
  if (name === "write_file") {
    if (typeof args.content !== "string") return { content: "Missing file content.", isError: true };
    try {
      mkdirSync(dirname(abs), { recursive: true });
    } catch {
      /* writeFileInProject re-validates and reports */
    }
    const r = writeFileInProject(abs, args.content);
    if (!r.ok) return { content: `Cannot write "${rel}" (${r.error}).`, isError: true };
    return { content: `Saved ${rel} (${args.content.length} bytes).`, isError: false };
  }
  return { content: `Unknown tool "${name}".`, isError: true };
}

/** Display shape for the transcript: mirror the names the UI already renders
 *  for the default engine (Write gets the diff-style block, etc.). */
export function toolDisplay(cwd: string, name: string, args: Record<string, unknown>): { name: string; input: Record<string, unknown> } {
  const abs = resolveInProject(cwd, args.path);
  const rel = abs ? relative(cwd, abs) || "." : String(args.path ?? "");
  if (name === "read_file") return { name: "Read", input: { file_path: rel } };
  if (name === "write_file") return { name: "Write", input: { file_path: rel, content: args.content ?? "" } };
  return { name: "LS", input: { path: rel } };
}

function systemPrompt(cwd: string, systemAppend?: string): string {
  const project = cwd.split(sep).filter(Boolean).pop() ?? "project";
  return (
    `You are a coding assistant working inside the project folder "${project}". ` +
    `Use the available tools to explore, read, create and modify project files whenever the task needs it — ` +
    `don't just describe changes, apply them with write_file. File paths are relative to the project root. ` +
    `When you are done, summarize what you did.` +
    (systemAppend ? `\n\n${systemAppend}` : "")
  );
}

/* ---- one streamed /api/chat round ---- */

interface ChatChunk {
  message?: { content?: string; thinking?: string; tool_calls?: ToolCall[] };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface RoundResult {
  text: string;
  toolCalls: ToolCall[];
  final: ChatChunk | null;
}

async function streamChatRound(params: {
  model: string;
  messages: ChatMessage[];
  tools: boolean;
  signal: AbortSignal;
  msgId: string;
  send: (e: AgentEvent) => void;
}): Promise<RoundResult> {
  const { model, messages, tools, signal, msgId, send } = params;
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, ...(tools ? { tools: TOOLS } : {}) }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`ollama responded ${res.status}: ${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const toolCalls: ToolCall[] = [];
  let final: ChatChunk | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof chunk.error === "string") throw new Error(chunk.error);
      const thinking = chunk.message?.thinking;
      if (typeof thinking === "string" && thinking) send({ type: "thinking", id: msgId, text: thinking });
      const content = chunk.message?.content;
      if (typeof content === "string" && content) {
        text += content;
        send({ type: "text", id: msgId, text: content });
      }
      if (Array.isArray(chunk.message?.tool_calls)) toolCalls.push(...chunk.message.tool_calls);
      if (chunk.done) final = chunk;
    }
  }
  return { text, toolCalls, final };
}

export async function runOllamaTurn(req: TurnRequest): Promise<void> {
  const { turnId, turn, prompt, cwd, sessionId, config, lang, model, systemAppend, send } = req;
  const started = Date.now();

  const sid = sessionId || randomUUID();
  const chat = sessionId ? loadChat(sessionId) : { model: undefined, messages: [] as ChatMessage[] };
  const resolvedModel = model || chat.model || (await installedModels())[0];
  if (!resolvedModel) {
    send({ type: "error", message: genericError(lang) });
    return;
  }

  const sys: ChatMessage = { role: "system", content: systemPrompt(cwd, systemAppend) };
  const messages: ChatMessage[] = [...chat.messages, { role: "user", content: prompt }];
  send({
    type: "ready",
    turnId,
    sessionId: sid,
    model: resolvedModel,
    tools: TOOLS.map((t) => t.function.name),
    slashCommands: [],
    apiKeySource: "none",
  });

  let totalIn = 0;
  let totalOut = 0;
  let toolsEnabled = true;
  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      let result: RoundResult;
      try {
        result = await streamChatRound({
          model: resolvedModel,
          messages: [sys, ...messages],
          tools: toolsEnabled,
          signal: turn.abort.signal,
          msgId: `ol_${turnId}_r${round}`,
          send,
        });
      } catch (e) {
        // Models without tool support get a plain-chat fallback.
        if (toolsEnabled && e instanceof Error && /does not support tools/i.test(e.message)) {
          toolsEnabled = false;
          round--;
          continue;
        }
        throw e;
      }
      totalIn += result.final?.prompt_eval_count ?? 0;
      totalOut += result.final?.eval_count ?? 0;
      messages.push({
        role: "assistant",
        content: result.text,
        ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}),
      });
      if (!result.toolCalls.length) break;

      for (const [i, call] of result.toolCalls.entries()) {
        const fnName = call.function?.name ?? "";
        const args = (call.function?.arguments ?? {}) as Record<string, unknown>;
        const display = toolDisplay(cwd, fnName, args);
        const toolUseId = `olt_${turnId}_${round}_${i}`;
        send({ type: "tool_use", id: toolUseId, name: display.name, input: display.input });

        let outcome: ToolOutcome;
        // Writes ask for confirmation when the profile wants it; reads never do.
        if (fnName === "write_file" && config.behavior === "ask") {
          const approvalId = randomUUID();
          const meta = {
            approvalId,
            turnId,
            toolName: display.name,
            title: String(display.input.file_path ?? ""),
            target: String(display.input.file_path ?? "") || undefined,
            risk: "normal" as const,
            severity: "write",
            askedAt: Date.now(),
          };
          send({ type: "approval_request", ...meta, input: display.input });
          const decision = await new Promise<{ allow: boolean; message?: string }>((resolvePromise) => {
            // Metadata kept server-side for the P7.1 remote view.
            turn.pendingApprovals.set(approvalId, { meta, resolve: resolvePromise });
          });
          outcome = decision.allow
            ? execProjectTool(cwd, fnName, args)
            : { content: decision.message ?? "Denied by the user.", isError: true };
        } else {
          outcome = execProjectTool(cwd, fnName, args);
        }

        send({ type: "tool_result", toolUseId, content: outcome.content, isError: outcome.isError });
        messages.push({ role: "tool", tool_name: fnName, content: outcome.content });
      }
    }

    saveChat(sid, { model: resolvedModel, messages });
    send({
      type: "done",
      sessionId: sid,
      isError: false,
      subtype: "success",
      numTurns: 1,
      durationMs: Date.now() - started,
      totalCostUsd: 0,
      usage: { input_tokens: totalIn, output_tokens: totalOut },
    });
  } catch (e) {
    if (turn.abort.signal.aborted) {
      // Keep what already accumulated so resume isn't lossy.
      saveChat(sid, { model: resolvedModel, messages });
      send({ type: "done", sessionId: sid, isError: false, subtype: "aborted", numTurns: 0, durationMs: 0, totalCostUsd: 0, usage: null });
    } else {
      console.error("[ollama-runner] turn error:", e instanceof Error ? e.message : e);
      send({ type: "error", message: genericError(lang) });
    }
  }
}
