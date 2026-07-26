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
already existed); **context compaction** — broom button: a short recap turn, then a fresh engine session inheriting only the recap (visible history untouched, tokens saved); **HTML file preview** — right-click an .html file in the tree → rendered in the browser from the project's separate-origin static server; **project folders in the sidebar** — colored, collapsible,
logical groups (registry metadata, nothing moves on disk) with drag & drop of
projects into folders, inline create/rename, palette colors.

**P6.11.7 — Project manager, read-only sidebar.** Owner feedback: folder
*organization* belongs in the Projects window, not the sidebar. The Projects
window is now a two-pane manager — a left folder rail (create/rename/recolor/
delete folders, click to filter, drop a project to file it) and the project
list (drag a row onto a folder, or a per-project "Move to folder" menu; each
row shows a colored folder badge). The main sidebar is now read-only: it shows
only the *open* projects, nested under their folder (colored label,
collapsible, unpin) — folders with no open project are hidden, and there is no
folder creation/editing there anymore (the old "+ New folder" is gone).

## P7 — Auth/TLS (shipped 2026-07-26)

App-level login and encrypted transport. Closes the "no app auth" gap and is a
prerequisite for P7.1.

**Password (optional, proposed once).** First run shows "Protect easyagent":
create a password, or "continue without a password" — the choice is remembered
so the screen never nags again, and either way it can be changed later from
Settings → Access. Passwords are scrypt-hashed in `~/.easyagent/auth.json`
(mode 0600); sessions are random 256-bit ids whose SHA-256 digests (never the
cookie value) live in `auth-sessions.json`, 30-day expiry with sliding renewal,
capped at 20. The cookie is HttpOnly + SameSite=Strict (+ Secure under HTTPS).
Login is rate-limited: 5 free attempts, then a doubling cool-down capped at 15
minutes. `src/proxy.ts` gates every route — APIs answer 401, pages redirect to
`/login` — on top of the existing loopback/origin checks and the per-process
CSRF token, which every auth POST still requires.

**TLS (built, off by default).** Settings → Access has an HTTPS toggle: it
generates a self-signed cert into `~/.easyagent/tls` (825 days, SAN
localhost/127.0.0.1/::1) and takes effect on restart. Default stays HTTP on
127.0.0.1 — traffic never leaves the machine, and no browser cert warning.
`next start` can't serve TLS, so `server.mjs` (custom server) picks the scheme
at boot from the settings flag and falls back to HTTP if the cert is missing.

## P7.1 — Secure remote access (shipped 2026-07-26)

Control sessions from a phone: read-only view of live turns plus approve/deny
for pending approvals, at `/m`. Explicitly scoped down — no remote IDE, no way
to start a turn, no transcript, no editor.

**Architecture.** The server used to keep only the approval *resolvers*
(`Map<approvalId, resolve>`); the title/risk travelled the SSE stream and lived
solely in the browser that started the turn, which a phone can never join. The
map now stores `{resolve, meta}`, so `/api/remote/state` can list what is
waiting (plus a `target` — the file path or command — since the phone has no
diff view and must not approve blind). Deciding from the phone reuses
`/api/chat/approve`; the turn now carries an `emit` hook, so the desktop's
stream gets an `approval_resolved` event and its modal disappears.

**Network.** Off by default. Settings → Access has an "Access from your phone"
toggle: it binds every interface instead of loopback and is refused unless an
app password exists — it also forces HTTPS on. Those preconditions are checked
in the settings route AND re-checked at boot in `server.mjs`, so a hand-edited
settings file or a deleted certificate cannot open the door. The proxy's
loopback rule is replaced (only while remote is on) by "Origin/Referer must
equal Host", keeping the CSRF property for any hostname. Red actions need a
second, deliberate tap on the phone.

Reaching the machine from outside the local network still needs a port forward
on the router, which exposes the app to the internet behind the password and
rate limit alone. Adequate for testing; the planned server deployment should
add real login + 2FA before it is left on.

**P7.2 — The address to type (2026-07-26).** Settings → Access only showed the
LAN address, which is useless from outside the house. It now lists both, each
with a copy button (typing an https URL with a port on a phone is the chore
that makes a feature go unused): "On the same Wi-Fi" from the local interfaces,
and "From outside your home" behind a *Find my external address* button. That
lookup calls an external echo service (api.ipify.org), so it is on demand only
— opening Settings must never call a third party silently — with a 5s timeout,
and the reply is rendered only after it validates as a bare IP address. The
external row carries the port-forward caveat.

## P8 — Server deployment (in progress)

Owner intent 2026-07-26: run easyagent on a VPS (Hostinger KVM 2, Ubuntu
24.04), with "a proper login with 2FA" once it lives there.

**Shipped — behind a reverse proxy.** P7.1's remote mode binds every interface
and needs the app to serve TLS itself, which is the wrong shape for a server:
there, Caddy should hold 443 with a real Let's Encrypt certificate and forward
to the app on loopback. `EASYAGENT_PUBLIC_ORIGIN` declares the public address —
the proxy then accepts that one Host (and loopback) and nothing else, session
cookies are marked Secure, and, crucially, **a password stops being optional**:
the first-run "continue without one" is removed from the UI *and* refused by
the route, so a public deployment can never be one click from open. A prior
local "skip" does not carry over. `EASYAGENT_MAX_TURNS` caps parallel turns for
small boxes. Full instructions in `docs/vps.md`.

**Still open — the 2FA the owner asked for.** The gate remains one password
plus the login rate limit. Until then `docs/vps.md` points at an
authenticating proxy for anything valuable.

## Postponed

- **Gemini engine** — postponed for ToS reasons (see `docs/providers.md`,
  decision 2026-07-21).
- **Grok interactive approvals (ACP)** — "a later phase" note in
  `src/server/providers/grok/runner.ts`; success-path still needs a live-login
  verification.
