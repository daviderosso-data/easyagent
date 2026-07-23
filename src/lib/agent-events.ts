// Shared, client-safe types. NO import from the Agent SDK here (this file is
// imported by client components; the SDK is server-only).

import type { Lang } from "@/lib/settings";
import type { Effort } from "@/lib/models";

export interface SendRequest {
  prompt: string;
  cwd: string;
  sessionId?: string;
  lang: Lang;
  /** Engine to run the turn ("claude" today; more in P6). Omit = default. */
  provider?: string;
  model?: string;
  effort?: Effort;
  /** Role persona appended to the system prompt (orchestrator role panels). */
  systemAppend?: string;
  /** Server-minted grant (from /api/orchestrate) → use the autonomous-but-safe
   *  orchestration security config. The server validates it; a bare flag from
   *  the client can never downgrade the profile. */
  orchestrationGrant?: string;
}

/** Events streamed from the server (SSE) to the browser. */
export type AgentEvent =
  | {
      type: "ready";
      turnId: string;
      sessionId: string;
      model: string;
      tools: string[];
      slashCommands: string[];
      apiKeySource: string;
      /** External connections available this turn, with startup status. */
      mcpServers?: { name: string; status: string }[];
      /** Skill names loaded for this turn (bundled + project). */
      skills?: string[];
    }
  | { type: "text"; id: string; text: string }
  | { type: "thinking"; id: string; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | {
      type: "approval_request";
      approvalId: string;
      turnId: string;
      toolName: string;
      input: Record<string, unknown>;
      title: string;
      /** "red" = extra-danger tier needing type-to-confirm. */
      risk: "normal" | "red";
      /** Machine-readable danger category; localized on the client. */
      severity: string;
    }
  | {
      type: "done";
      sessionId: string;
      isError: boolean;
      subtype: string;
      numTurns: number;
      durationMs: number;
      totalCostUsd: number;
      usage: unknown;
    }
  | { type: "error"; message: string; code?: "rate-limit" };

export interface ApproveRequest {
  turnId: string;
  approvalId: string;
  decision: "allow" | "deny";
  alwaysAllow?: boolean;
}
