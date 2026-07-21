// Ollama engine: local models over the daemon's HTTP API (streaming NDJSON).
// Chat-only in P6 — no tools, no approvals; conversation history lives in
// chat-store.ts so sessions survive across turns.

import { randomUUID } from "node:crypto";
import { genericError } from "@/server/i18n-server";
import type { EngineStatus, ProviderModel, TurnRequest } from "@/server/providers/types";
import { loadChat, saveChat, type ChatMessage } from "@/server/providers/ollama/chat-store";

export const OLLAMA_URL = process.env.EASYAGENT_OLLAMA_URL || "http://127.0.0.1:11434";

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

/** One NDJSON chunk of /api/chat. */
interface ChatChunk {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

export async function runOllamaTurn(req: TurnRequest): Promise<void> {
  const { turnId, turn, prompt, sessionId, model, lang, send } = req;
  const started = Date.now();

  const sid = sessionId || randomUUID();
  const chat = sessionId ? loadChat(sessionId) : { model: undefined, messages: [] as ChatMessage[] };
  const resolvedModel = model || chat.model || (await installedModels())[0];
  if (!resolvedModel) {
    send({ type: "error", message: genericError(lang) });
    return;
  }

  const messages = [...chat.messages, { role: "user" as const, content: prompt }];
  send({
    type: "ready",
    turnId,
    sessionId: sid,
    model: resolvedModel,
    tools: [],
    slashCommands: [],
    apiKeySource: "none",
  });

  const msgId = `ol_${turnId}`;
  let text = "";
  let final: ChatChunk | null = null;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: resolvedModel, messages, stream: true }),
      signal: turn.abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`ollama responded ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
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
        const thinking = chunk.message?.thinking;
        if (typeof thinking === "string" && thinking) send({ type: "thinking", id: msgId, text: thinking });
        const content = chunk.message?.content;
        if (typeof content === "string" && content) {
          text += content;
          send({ type: "text", id: msgId, text: content });
        }
        if (chunk.done) final = chunk;
      }
    }

    saveChat(sid, { model: resolvedModel, messages: [...messages, { role: "assistant", content: text }] });
    send({
      type: "done",
      sessionId: sid,
      isError: false,
      subtype: "success",
      numTurns: 1,
      durationMs: final?.total_duration ? Math.round(final.total_duration / 1e6) : Date.now() - started,
      totalCostUsd: 0,
      usage: { input_tokens: final?.prompt_eval_count ?? 0, output_tokens: final?.eval_count ?? 0 },
    });
  } catch (e) {
    if (turn.abort.signal.aborted) {
      // Keep what already streamed so resume isn't lossy.
      if (text) saveChat(sid, { model: resolvedModel, messages: [...messages, { role: "assistant", content: text }] });
      send({ type: "done", sessionId: sid, isError: false, subtype: "aborted", numTurns: 0, durationMs: 0, totalCostUsd: 0, usage: null });
    } else {
      console.error("[ollama-runner] turn error:", e instanceof Error ? e.message : e);
      send({ type: "error", message: genericError(lang) });
    }
  }
}
