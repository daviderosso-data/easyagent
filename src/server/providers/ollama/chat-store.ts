// Ollama is stateless, so easyagent keeps each conversation's messages on
// disk to support resume — one small JSON file per session.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** One tool invocation as Ollama represents it (arguments already parsed). */
export interface ToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> };
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface StoredChat {
  model?: string;
  messages: ChatMessage[];
}

const DIR = join(homedir(), ".easyagent", "ollama-chats");

function fileFor(sessionId: string): string | null {
  // Session ids are UUIDs we mint ourselves; reject anything path-like.
  if (!/^[0-9a-f-]{8,64}$/i.test(sessionId)) return null;
  return join(DIR, `${sessionId}.json`);
}

export function loadChat(sessionId: string): StoredChat {
  const file = fileFor(sessionId);
  if (!file) return { messages: [] };
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(j?.messages)) return { model: j.model, messages: j.messages };
  } catch {
    /* new or unreadable session → empty history */
  }
  return { messages: [] };
}

export function saveChat(sessionId: string, chat: StoredChat): void {
  const file = fileFor(sessionId);
  if (!file) return;
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(chat), "utf8");
  } catch {
    /* best effort — losing history only degrades resume */
  }
}
