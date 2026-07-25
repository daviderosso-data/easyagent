# Roadmap

Phases P1–P6.8 are shipped (see git history for details). This file tracks what
comes next. Decisions recorded here were made by the owner on 2026-07-22.

## P6.8 — Attachments + orchestrator advisor (shipped)

Owner request 2026-07-22: upload PDF / Markdown / images directly in chat —
saved into `<project>/attachments/` and referenced in the prompt — and in the
orchestrator modal as shared reference material (staged, then moved into
`<project>/reference/` on launch). The orchestrator also recommends useful
marketplace skills (installable on launch) and MCP connectors (one-click for
local presets) based on the plan.

## P6.9 — Product features

Ordered by value/effort. All must respect the standing UX rules: one action →
one entry point, plain language, defaults over config.

- **P6.9.1 — One-click "Undo last turn" (shipped 2026-07-23)** — the existing
  pre-turn snapshots surfaced as an Undo button on the session panel (restores
  the newest save point; itself undoable from the History panel).
- **P6.9.2 — Desktop notifications (shipped 2026-07-23)** — opt-in toggle in
  Settings; notifies when the app is in the background about a finished long
  turn (>10s), a waiting approval, a failed turn (incl. rate limits), or an
  orchestration outcome. Role panels stay silent during orchestration.
- **P6.9.3 — Unified approvals inbox (shipped 2026-07-23)** — sidebar list of
  every pending approval across all sessions/projects; click jumps to the right
  project and panel.
- **P6.9.4 — A/B engine comparison (shipped 2026-07-23)** — split icon spawns a
  linked twin panel on another engine; prompts sent to either go to both. Both
  share the project files (the popover says so) — best for questions/proposals.
- **P6.9.5 — Engine doctor (shipped 2026-07-23)** — Settings → Other engines →
  expandable report: binary, version, login, Ollama daemon, with the exact
  install/start command for whatever is broken.
- **P6.9.6 — Engine failover suggestion (shipped 2026-07-23)** — providers tag
  usage-limit errors; a bar offers the other usable engines (fresh conversation,
  transcript stays visible).
- **P6.9.7 — Export session (shipped 2026-07-23)** — Markdown/HTML download from
  the History panel, file changes and costs included.
- **P6.9.8 — "Open PR" (shipped 2026-07-23)** — History → git section: branch
  off the default branch if needed, push, `gh pr create`; title/description
  prefilled from the transcript, editable.
- **P6.9.9 — Images (shipped 2026-07-23)** — in-app viewer for project images
  (confined `/api/fs/raw`), plus a one-click "image generation" preset skill so
  Claude chats can create images through Codex's built-in image tool (ChatGPT
  subscription, no API key). Codex panels generate images natively with no
  setup. Grok has no CLI image tool yet (Imagine is app/API-only).

Also 2026-07-23: the launcher now rebuilds when the code is newer than the
build — a stale `.next` was silently hiding new features (how the GPT-5.6
models stayed invisible).

## P6.10 — Copilot engine (shipped 2026-07-24)

Fifth engine: GitHub Copilot CLI via the user's GitHub login (no API key) —
the best surviving login-based CLI per the 2026-07-24 research (Qwen/iFlow
shut down, Amazon Q→Kiro closed to new signups and its ToS forbids wrappers,
Gemini still forbidden). Free plan works (monthly AI-credits allotment);
multi-vendor models (Claude/GPT-5.6/Kimi) parsed live from the CLI. See
docs/providers.md for the spike notes.

## P6.11 — Workspace pro (shipped 2026-07-25)

Owner requests of 2026-07-25: **A/B up to 4 models** (comparison groups, one
project copy per variant, chip ×N); **message queue** — send to a busy panel
and it runs right after the turn (removable chips, Stop clears); **drag & drop
in the file tree** (folders + background as drop targets; manual file creation
already existed); **project folders in the sidebar** — colored, collapsible,
logical groups (registry metadata, nothing moves on disk) with drag & drop of
projects into folders, inline create/rename, palette colors.

## P7 — Auth/TLS (next major phase)

App-level login and encrypted transport. Closes the "no app auth" gap and is a
prerequisite for P7.1.

## P7.1 — Secure remote access (after P7)

Control sessions from a phone: read-only view of panels plus approve/deny for
pending approvals. Explicitly scoped down — no remote IDE. Requires P7's
auth/TLS; scheduled immediately after it.

## Postponed

- **Gemini engine** — postponed for ToS reasons (see `docs/providers.md`,
  decision 2026-07-21).
- **Grok interactive approvals (ACP)** — "a later phase" note in
  `src/server/providers/grok/runner.ts`; success-path still needs a live-login
  verification.
