# Provider abstraction (P5) and multi-engine (P6)

P5 introduced the `AgentProvider` seam; P6 registered the first non-Claude
engines. This document records the design, the spike findings (CLI probes run
2026-07-21 on macOS) and each adapter's implementation notes.

## P6 engine lineup (implemented 2026-07-21)

| Engine | Auth | Turn transport | Approvals | Resume | Effort |
|---|---|---|---|---|---|
| Claude Code (default) | subscription login (SDK) | Agent SDK `query()` | interactive modal | SDK sessions | yes |
| Codex (ChatGPT) | ChatGPT login held by the official binary (npx fallback if not installed) | `codex exec --json` JSONL | policy-only (`--ask-for-approval never` + sandbox level) | `exec resume <thread_id>` | no |
| Grok Build | SuperGrok / X Premium+ login held by the official binary | `grok -p … --output-format streaming-json` NDJSON | policy-only (`--sandbox`/`--permission-mode`); ACP interactive approvals are a later phase | `--resume <sessionId>` | yes (`--reasoning-effort`) |
| Ollama (local) | none | HTTP `/api/chat` NDJSON | n/a (no tools in P6 — chat only) | easyagent-side history (`~/.easyagent/ollama-chats/`) | no |

Verified live 2026-07-21 (real event captures in the session scratchpad,
`p6samples/`): Codex turn + resume from the UI (tool call rendered, output,
done, usage recorded with cached tokens), Ollama streaming turn (token
deltas, usage), Grok unauthenticated error path. Codex gotchas discovered
live and encoded in `codex/runner.ts`: `exec` rejects `--ask-for-approval`
(it never prompts by construction — sandbox flag only); `exec resume`
rejects `--sandbox`/`-m` (a resumed thread keeps its original settings) and
wants flags before the positional session id; the `--json` stream never
names the model and has no token-level text deltas (whole messages only).
Grok's success-path stream shapes remain doc-derived until a login exists —
the mapper is tolerant and the error path is verified.

Cross-cutting rules, enforced by the neutral pipeline (`agent-runner.ts`):
every engine gets the pre-turn save point, identical usage analytics
(normalized token keys on the `done` event) and guaranteed slot release.
Security profiles map per engine (unit-tested in
`tests/providers-engines.test.ts`): headless engines cannot ask, so
behavior "ask" degrades to a read-only sandbox — locked stays read-only,
standard stays confined to the workspace, open means full access, and
orchestration turns stay sandboxed even though they never prompt.
Ambient API keys are scrubbed from every engine subprocess (`engineEnv`), so
login-based auth is structural, not conventional.

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

All probed engines expose a headless path a web GUI can drive. Event models
differ substantially; the `AgentEvent` mapping layer per engine is the real
work of P6.

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

### xAI Grok Build (`grok`, probed v0.2.106, Apache-2.0) — official, added 2026-07-21

xAI ships an official agentic CLI, **Grok Build** (github.com/xai-org/grok-build,
Rust, open-sourced 2026-07-15, ~21k stars; installed via `x.ai/cli` script or
brew cask `grok-build` — not on npm). Its flag surface is deliberately
Claude Code-compatible, making it the easiest engine to adapt after Claude:

- Headless: `grok -p <prompt> --output-format json|streaming-json` (NDJSON
  events `text|thought|end|error`; `end` carries usage + cost — cost is often
  absent on subscription runs), `--json-schema` for structured output,
  `--reasoning-effort none..xhigh`, `-m` model, exit codes 0/1/130/143.
- **ACP**: `grok agent stdio` (JSON-RPC over stdio: streamed `session/update`
  plus **interactive permission round-trips** — the only path for our approval
  modal; headless approvals are policy-only). Also `agent serve` (WebSocket,
  survives reconnects) and `agent headless` (outbound relay, explicitly "for
  building web UIs").
- Permissions: `--permission-mode default|acceptEdits|auto|dontAsk|bypassPermissions|plan`,
  repeatable `--allow`/`--deny` rules (`Bash(npm*)` style), `--sandbox
  off|workspace|devbox|read-only|strict` kernel-enforced (Seatbelt on macOS;
  child-process network blocking is Linux-only), custom deny globs (`.env`,
  `**/*.pem`) — maps cleanly onto our three profiles.
- Auth: browser OAuth with the user's **SuperGrok / X Premium+ subscription**
  (or `grok login --device-code`), `XAI_API_KEY` fallback; credentials in
  `~/.grok/auth.json` (0600); `GROK_HOME` relocates all state. Auth check:
  `grok models` prints "You are not authenticated." (text-only, no `--json`).
  Unauthenticated headless run fails instantly with a single JSON error
  event, exit 1 — clean detection.
- Sessions (`-c`, `-r`, `--session-id`, `--fork-session`; SQLite under
  `~/.grok/sessions/`), git worktrees, MCP/skills/plugins/hooks, `export`.
- Cautions: auto-updater (set `GROK_DISABLE_AUTOUPDATER=1`); subscription
  usage draws from one weekly pool shared across all Grok products; the
  community npm `@vibe-kit/grok-cli` also installs a `grok` binary and abuses
  `~/.grok` — detect collisions; corporate churn (xAI → SpaceX 2026-02,
  "SpaceXAI" rebrand 2026-07) makes terms worth re-checking at P6 time.

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
| xAI Grok Build | **Allowed** — xAI runs an explicit "use your Grok subscription in third-party agents" OAuth program (Hermes, OpenClaw, OpenCode, Kilo Code, Warp) and markets ACP for "your own bots and agent orchestration apps"; wrapping the official CLI with the user's own login is the sanctioned pattern | AUP bans automated access to *consumer* surfaces (don't reverse-engineer grok.com); no anti-wrapper clause for CLI/OAuth/API paths | `XAI_API_KEY` on OpenAI-compatible `api.x.ai/v1` (expressly licensed "Bundled Services" grant) |

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
  within terms. **Owner decision 2026-07-21: Gemini is postponed** (neither
  login nor API key for now).
- **Grok**: viable third engine, structurally the closest twin of the Claude
  integration (subscription login held by the official binary, streaming
  JSON, per-tool approvals via ACP, sandbox/permission flags mapping onto our
  profiles). Two adapter strategies: per-turn `grok -p … --output-format
  streaming-json -r <sessionId>`, or persistent `grok agent stdio` (ACP) when
  we need interactive approvals. Don't register our own OAuth client (no
  public self-serve program) — ride the official CLI's login. Keep "Grok" out
  of product name/logo/domain.
- **Branding**: keep engine names out of the product name/logo/domain
  ("easyagent" ✓), describe compatibility nominatively ("works with …"), add a
  no-affiliation line to the README before open-sourcing.
