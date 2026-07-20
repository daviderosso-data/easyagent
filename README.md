# easyagent

[![CI](https://github.com/daviderosso-data/easyagent/actions/workflows/ci.yml/badge.svg)](https://github.com/daviderosso-data/easyagent/actions/workflows/ci.yml)

A local web interface for [Claude Code](https://claude.com/claude-code) — the full coding agent — for
people who don't use a terminal. Every file change appears as a visual diff with one-click approval; work
stays inside your project folder and runs on your own subscription. Includes security profiles, parallel
sessions, a multi-agent orchestrator and project management.

> Status: work in progress. Everything below is implemented and working; expect rough edges.

## What it is

easyagent wraps the **full Claude Code agent** (it reads and writes files, runs commands, uses git) in a
clean graphical interface instead of the terminal, so non-technical people can build and fix real projects
safely. It is not a limited chat: it has the same capabilities as terminal Claude Code — only the
experience is friendlier. Every action that changes something is shown as a visual diff and gated by a
simple approve / deny button.

The app runs **entirely on your machine**, uses **your own Claude subscription** (you sign in from the
browser; nothing is stored by the app), and confines the agent to a single projects folder.

## Features

- Full Claude Code agent with a visual UI: streaming activity, file tree, diffs, command output.
- Three security profiles (Locked / Standard / Open) with an OS-level sandbox (macOS), a deny-list for
  destructive commands, secret-file protection, and per-command confirmations. On Windows there is no OS
  sandbox: enforcement relies on the command filter and deny rules.
- Multi-agent orchestrator: describe a goal and it splits the work into roles (e.g. backend, frontend,
  design), runs them in parallel in their own sub-folders, then integrates and tests the result.
- Project management: a dashboard to create, open, rename and delete projects, with real conversation
  history and resume, plus automatic restore of your open panels after a restart.
- Up to four parallel chats, each with its own project, model (Opus 4.8 / Fable 5 / Sonnet 5 / Haiku 4.5)
  and reasoning effort.
- English and Italian interface, light and dark theme.
- One double-click launcher for macOS and Windows.
- Local-only server with an anti-CSRF / origin guard, so the agent cannot be reached from other websites
  or from the network.

## Requirements

- [Node.js](https://nodejs.org) 20.9 or newer.
- [Claude Code](https://claude.com/claude-code) installed and signed in with your Claude subscription
  (Pro/Max). You can sign in from inside the app (Settings → Account); easyagent reuses Claude Code's own
  login and never sees your password or API key.

## Quick start

Double-click the launcher for your platform:

- macOS: `launch.command`
- Windows: `launch.bat`

On the first run it installs dependencies and builds the app, then starts the local server and opens your
browser at `http://127.0.0.1:3000`. Close the terminal window to stop it.

### Manual start (developers)

```bash
npm install
npm run dev        # development, at http://127.0.0.1:3000
# or
npm run build && npm start
```

Quality checks (also run in CI on macOS and Windows):

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint (flat config)
npm run test       # vitest (watch); npm run test:run for a single pass
```

The test suite is a regression harness for the security and turn-lifecycle
code — secret detection, working-directory confinement, the concurrency-slot
lifecycle, and orchestration grants live in `tests/`.

## Security profiles

Everything is configurable in Settings → Security. Three presets, each tweakable:

| Profile | Behavior |
| --- | --- |
| Locked (default) | OS sandbox on; destructive commands and secret reads always blocked; installs and internet access need an explicit typed confirmation; edits ask before applying. |
| Standard | Same hard blocks and sandbox, but installs and internet ask a normal yes/no and file edits apply automatically. |
| Open | No limits and no confirmations (behind a warning). Full freedom, full risk. |

In Locked and Standard the hard gates (block-list, PreToolUse hook, OS sandbox on macOS) cannot be
bypassed by the agent, even in autonomous mode. **Open disables all of them by design** — it really means
full freedom. Multi-agent orchestration runs always keep a safety floor regardless of profile: sandbox on,
catastrophic commands and secret reads blocked.

## Privacy and security

- Runs locally only, bound to `127.0.0.1`; a request-origin guard rejects any cross-site or off-machine
  request.
- Uses your own Claude Code credentials (subscription or API key); the app never sees or stores them, and
  strips API-key environment variables so turns use your subscription.
- In Locked and Standard the agent is confined to `~/easyagent` and cannot read your secrets (`~/.ssh`,
  `~/.aws`, `.env`, `.netrc`, `.npmrc`, …). Your sensitive environment variables are never passed to the
  agent. On macOS this is enforced by the OS sandbox too; on Windows by the command filter and deny rules.

## How it works

A single [Next.js](https://nextjs.org) app drives the agent through
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Each
request is a `query()` call streamed to the browser over Server-Sent Events; a `PreToolUse` hook plus an OS
sandbox enforce the security policy, and mutating actions are surfaced as an approval modal with a diff.

Local state lives in your home folder, outside the repo:

- `~/easyagent/` — your project folders.
- `~/.easyagent/` — app settings, project metadata, workspace layout and usage stats.

## License

[MIT](./LICENSE).
