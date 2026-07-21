import { listSessions, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mapSessionMessages } from "@/server/message-map";
import type { SessionSummary } from "@/server/providers/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Past Claude Code conversations for a project directory. */
export async function listProjectSessions(dir: string): Promise<SessionSummary[]> {
  try {
    const sessions = (await listSessions({ dir, includeProgrammatic: true, limit: 50 } as any)) as any[];
    return sessions
      .map((s) => ({
        sessionId: s.sessionId,
        firstPrompt: (s.customTitle || s.firstPrompt || s.summary || "").slice(0, 200),
        summary: s.summary ?? "",
        lastModified: s.lastModified ?? s.createdAt ?? 0,
      }))
      .filter((s) => s.sessionId);
  } catch {
    return [];
  }
}

/** Load a past conversation, mapped to the store's transcript items. */
export async function loadSessionItems(sessionId: string): Promise<any[]> {
  try {
    const msgs = (await getSessionMessages(sessionId)) as any[];
    return mapSessionMessages(msgs);
  } catch {
    return [];
  }
}
