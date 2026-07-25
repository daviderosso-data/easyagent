// The provider contract: one engine = one AgentProvider. A provider turns a
// TurnRequest into a stream of AgentEvents (the client protocol) via send() —
// nothing downstream of that seam knows which engine produced the events.
// Everything provider-neutral (concurrency slot, save-point snapshot, usage
// analytics) lives in the runTurn pipeline (agent-runner.ts), so providers
// can't get it wrong or drift apart.

import type { AgentEvent } from "@/lib/agent-events";
import type { SecurityConfig, Lang } from "@/lib/settings";
import type { Turn } from "@/server/session-manager";

/** Engines the app can drive — see docs/providers.md for the spike findings.
 *  ("gemini" is reserved: postponed by owner decision 2026-07-21.) */
export type ProviderId = "claude" | "codex" | "grok" | "copilot" | "ollama" | "gemini";

/** One turn, as handed to a provider by the neutral pipeline. */
export interface TurnRequest {
  turnId: string;
  /** Registered in the sessionManager by the route; the provider must honour
   *  turn.abort and resolve turn.pendingApprovals it creates. Slot release is
   *  NOT the provider's job (the pipeline guarantees it). */
  turn: Turn;
  prompt: string;
  cwd: string;
  sessionId?: string;
  config: SecurityConfig;
  lang: Lang;
  model?: string;
  effort?: string;
  systemAppend?: string;
  /** Emit protocol events. The last event MUST be `done` or `error`; a `done`
   *  should carry usage with Anthropic-style token keys (input_tokens,
   *  output_tokens, cache_read_input_tokens, cache_creation_input_tokens) —
   *  the pipeline records analytics from it. Providers normalize into that. */
  send: (e: AgentEvent) => void;
}

/** What an engine can do — lets the UI adapt per provider (P6) instead of
 *  feature-flagging by name. */
export interface ProviderCapabilities {
  /** Interactive per-tool approvals (the approve/deny modal flow). */
  approvals: boolean;
  /** External MCP connections. */
  mcp: boolean;
  /** Project skills loading. */
  skills: boolean;
  /** Server-side session resume across turns. */
  resume: boolean;
  /** Reasoning-effort selector. */
  effort: boolean;
  /** Slash-command palette. */
  slashCommands: boolean;
  /** Subscription rate-limit introspection. */
  rateLimits: boolean;
}

export interface SessionSummary {
  sessionId: string;
  firstPrompt: string;
  summary: string;
  lastModified: number;
}

/** One entry of the per-chat model selector. id null = engine default. */
export interface ProviderModel {
  id: string | null;
  label: string;
}

/** Live availability, shown in the UI so a missing engine explains itself. */
export interface EngineStatus {
  /** The engine can run on this machine (binary found / daemon reachable). */
  installed: boolean;
  /** null = the engine needs no login (e.g. local models). */
  loggedIn: boolean | null;
}

export interface AccountStatus {
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
  authMethod?: string;
}

/** Login/logout for engines authenticated via account login (not API key). */
export interface AccountFacet {
  status(): Promise<AccountStatus>;
  /** Launches the (browser) login flow detached; poll status() to detect
   *  completion. Device-code flows resolve with the code + URL the user must
   *  enter (the login route returns them to the UI immediately). */
  startLogin(): void | Promise<{ verificationUrl: string; userCode: string } | void>;
  waitForLogin(timeoutMs?: number): Promise<AccountStatus>;
  logout(): Promise<void>;
}

/** Stored-conversation history, when the engine persists sessions on disk. */
export interface HistoryFacet {
  listSessions(dir: string): Promise<SessionSummary[]>;
  loadSessionItems(sessionId: string): Promise<unknown[]>;
}

export interface AgentProvider {
  id: ProviderId;
  label: string;
  capabilities: ProviderCapabilities;
  /** Stream one turn. Must emit `done` or `error` as its final event and never
   *  throw for normal failures (auth, abort, engine errors → events). */
  runTurn(req: TurnRequest): Promise<void>;
  /** Options for the per-chat model selector (first entry = engine default). */
  models(): Promise<ProviderModel[]>;
  /** Availability probe for the UI. Must be fast (short timeouts) and never throw. */
  status(): Promise<EngineStatus>;
  /** Absent when the engine needs no login (e.g. local models). */
  account?: AccountFacet;
  /** Absent when the engine has no stored sessions to browse. */
  history?: HistoryFacet;
}
