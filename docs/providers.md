# Provider abstraction (P5) and the road to multi-engine (P6)

P5 introduced the `AgentProvider` seam. This document records the design and
the P6 spike findings (CLI probes run 2026-07-21 on macOS, read-only, no
logins performed).

## Architecture

```
route (chat/send) ──► runTurn pipeline ──► AgentProvider.runTurn ──► AgentEvent stream ──► SSE ──► client
                      (agent-runner.ts)    (providers/<engine>/)      (lib/agent-events.ts)
```

- **`src/lib/agent-events.ts`** — the protocol. Everything downstream (SSE,
  client store, transcript) is engine-agnostic and unchanged.
- **`src/server/providers/types.ts`** — the contract: an `AgentProvider` turns
  a `TurnRequest` into `AgentEvent`s via `send()`. Optional facets: `account`
  (login-based auth), `history` (stored sessions). `capabilities` describes
  what the engine can do so the UI can adapt per provider in P6 instead of
  feature-flagging by name.
- **`src/server/providers/index.ts`** — the registry. P5 registers only
  `claude`; requests may name a provider (`SendRequest.provider`, validated by
  the route), omitted = default.
- **`src/server/agent-runner.ts`** — the provider-neutral pipeline. It owns
  everything an engine must not get wrong or drift on: the pre-turn save
  point, usage/analytics recording (from the event stream itself — see
  `recordingSend`), and guaranteed concurrency-slot release. Providers only
  stream events.
- **`src/server/providers/claude/`** — the Claude Code engine (Agent SDK
  `query()`, sessions, account), moved from the old flat modules unchanged.

Usage normalization: a provider's `done` event carries usage with
Anthropic-style token keys (`input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`). Non-Claude runners
map their native usage into those keys; the pipeline records analytics
identically for every engine.

Still Claude-specific by design (candidates for provider facets in P6):
the orchestrator planning query (`orchestrator.ts`), the slash-command palette
(`api/commands`), MCP test runs (`api/mcp/test`), and subscription rate-limit
capture (`providers/claude/runner.ts#captureRateLimits`).

## P6 spike — engine probes (verified 2026-07-21)

All three target engines expose a headless path a web GUI can drive. Event
models differ substantially; the `AgentEvent` mapping layer per engine is the
real work of P6.

### OpenAI Codex CLI (`@openai/codex`, probed v0.144.6, Apache-2.0)

- Non-interactive: `codex exec` with `--json` (JSONL events: `thread.started`,
  `turn.started`, `item.completed`, `turn.failed`, `error`), `--output-schema`,
  `--output-last-message`, `--ephemeral`.
- Auth: ChatGPT-account browser OAuth (plus `--with-api-key` fallback).
  Credentials in `~/.codex/auth.json` (0600); `CODEX_HOME` relocates all state
  (verified) — useful for isolation. `codex login status` is a reliable
  non-interactive auth check.
- Resume: `codex exec resume <id>` / `--last`. Model: `-m`. MCP: first-class
  (`codex mcp add/list/...`), and `codex mcp-server` runs Codex *as* an MCP
  server. Also `--oss --local-provider ollama` (Codex itself can target local
  models).
- Safety mapping to our profiles: `--sandbox read-only|workspace-write|danger-full-access`
  × `--ask-for-approval untrusted|on-request|never`.
- Unauthenticated `exec` fails after ~25s of retries with `turn.failed`
  (401) — slow-noisy failure; detect auth *before* starting a turn.

### Google Gemini CLI (`@google/gemini-cli`, probed v0.51.0, Apache-2.0)

- Non-interactive: `-p/--prompt` with `--output-format text|json|stream-json`.
  Also exposes ACP (Agent Client Protocol) via `--acp` — an alternative
  integration surface worth evaluating in P6.
- Auth: Google-account OAuth (free Code Assist tier, `GOOGLE_GENAI_USE_GCA`)
  or `GEMINI_API_KEY`. No `login` subcommand and no status command: OAuth
  triggers interactively on first run; auth state must be inferred (probe or
  `~/.gemini` contents). Unauthenticated headless run fails fast and clean:
  single JSON error object, exit code 41.
- Resume: `--resume latest|N`, `--session-id`, `--list-sessions`. Model: `-m`.
  MCP: `gemini mcp add/remove/list/...`; also skills/extensions/hooks.
- Safety mapping: `--approval-mode plan|default|auto_edit|yolo` (+ `--sandbox`,
  policy engine files).
- Unverified without login: `stream-json` event vocabulary, free-tier quotas.

### Ollama (local, probed v0.32.1)

- Local HTTP API, no auth: `GET /api/tags` (models + capabilities),
  `POST /api/chat` streaming NDJSON token chunks (`done:true` terminator).
  Verified live with `qwen2.5:latest` (tool-calling capable).
- The daemon may not be running — the runner needs a liveness check
  (`GET /api/version`) and an auto-start nudge (invoking the CLI launches
  Ollama.app on macOS).
- No sessions/history/approvals: `capabilities` all-false except streaming;
  tool use would be our own loop (P1 fs-mutate toolkit as the toolbox).

## Terms-of-service review (researched 2026-07-21)

Summary of the compliance research for wrapping each engine in a personal,
single-user, local GUI using the owner's own accounts (no resale, not
multi-tenant, each user of an open-sourced build brings their own login).

| Engine | Login-based use in a wrapper | Explicit anti-wrapper clause | Clean fallback |
|---|---|---|---|
| Claude (Agent SDK) | **Allowed** — "ordinary, individual usage of Claude Code and the Agent SDK" is expressly contemplated; the ban targets developers routing plan credentials *on behalf of their users* | Yes, but scoped to multi-tenant routing | Console API key |
| OpenAI Codex CLI | **Gray, tolerated** — spawning the official binary that holds its own ChatGPT login; docs recommend API keys for "programmatic workflows" but document `codex exec` reusing saved auth, and the App Server is an official third-party-client surface | No | API key |
| Google Gemini CLI | **Prohibited-leaning** — the free personal-OAuth tier was shut down 2026-06-18 (moved to closed-source Antigravity CLI, whose ToS ban "products not provided by us"); Gemini CLI's own ToS doc names third-party OAuth use as a violation, remedy = account suspension | **Yes** (both Gemini CLI docs and Antigravity ToS) | `GEMINI_API_KEY` (Gemini API terms — built for programmatic use) |
| Ollama | Local, no auth, MIT | No | — |

Consequences for P6:

- **Claude**: keep the current design (SDK + subscription login). Caution: the
  announced-then-paused "Agent SDK credits" program would bill third-party-app
  usage against a smaller dedicated pool if un-paused; never handle the OAuth
  token outside the SDK/CLI's own mechanisms.
- **Codex**: login-based integration is viable — spawn the unmodified official
  binary, let it hold its own credentials (`codex login status` for detection).
  Identify the client honestly; watch for an Anthropic-style policy line being
  drawn later.
- **Gemini**: the "login not API key" decision (2026-07-20) is not achievable
  within terms — plan on **API-key auth** for Gemini (or skip it), and get
  explicit owner sign-off before any OAuth-based Gemini integration.
- **Branding**: keep engine names out of the product name/logo/domain
  ("easyagent" ✓), describe compatibility nominatively ("works with …"), add a
  no-affiliation line to the README before open-sourcing.
