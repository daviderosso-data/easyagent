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
- **P6.9.3 — Unified approvals inbox** — one global badge in the sidebar listing
  every pending approval across all sessions; click jumps to the right panel.
- **P6.9.4 — A/B engine comparison** — send the same prompt to two engines in
  side-by-side panels and pick the result to keep. Builds on split view +
  providers.
- **P6.9.5 — Engine doctor** — diagnostics panel per engine: binary found,
  version, login state, Ollama reachable, with guided one-click fixes.
- **P6.9.6 — Engine failover suggestion** — on rate limit mid-work, offer
  "continue with another engine" (the provider seam makes the switch cheap).
- **P6.9.7 — Export session** — transcript to Markdown/HTML including diffs.
- **P6.9.8 — "Open PR" from the History panel** — create branch + GitHub PR with
  title/description generated from the transcript (commit+push already exist).

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
