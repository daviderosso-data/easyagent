# Roadmap

Phases P1–P6.7 are shipped (see git history for details). This file tracks what
comes next. Decisions recorded here were made by the owner on 2026-07-22.

## P6.8 — Product features (planned, not started)

Ordered by value/effort. All must respect the standing UX rules: one action →
one entry point, plain language, defaults over config.

1. **One-click "Undo last turn"** — surface the existing pre-turn snapshots
   (`agent-runner.ts`) as an Undo button on the session panel, instead of only
   through the History panel.
2. **Desktop notifications** — system notification when a long turn finishes,
   an approval is waiting, or an engine hits a rate limit. Complements the
   multi-panel workspace (background tabs currently hide approvals).
3. **Unified approvals inbox** — one global badge in the sidebar listing every
   pending approval across all sessions; click jumps to the right panel.
4. **A/B engine comparison** — send the same prompt to two engines in side-by-side
   panels and pick the result to keep. Builds directly on split view + providers.
5. **Engine doctor** — diagnostics panel per engine: binary found, version,
   login state, Ollama reachable, with guided one-click fixes.
6. **Engine failover suggestion** — on rate limit mid-work, offer "continue with
   another engine" (the provider seam makes the switch cheap).
7. **Export session** — transcript to Markdown/HTML including diffs.
8. **"Open PR" from the History panel** — create branch + GitHub PR with
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
