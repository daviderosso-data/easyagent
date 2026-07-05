import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { withinProjectsRoot } from "@/server/projects";

/* ---- Per-process session token (anti-CSRF / local-process guard) ---- */
// Pinned on globalThis so Next dev HMR keeps a stable token across reloads.
const g = globalThis as unknown as { __ccw_token?: string };
export const SESSION_TOKEN: string = (g.__ccw_token ??= randomBytes(24).toString("hex"));

/** State-changing routes require this token (defends against non-browser local
 *  callers and requests missing browser headers). The token is only obtainable
 *  same-origin (the middleware blocks cross-site reads). */
export function tokenValid(req: Request): boolean {
  return req.headers.get("x-ccw-token") === SESSION_TOKEN;
}

/* ---- Environment allow-list handed to the agent subprocess ---- */
// Only pass clearly-safe vars + CLAUDE_* (auth/config). Everything else — AWS_*,
// GITHUB_TOKEN, *_API_KEY, DB URLs — is withheld so a Bash command can't read it.
const ENV_ALLOW = new Set<string>([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "LC_MESSAGES", "TERM", "COLORTERM", "TMPDIR", "TMP", "TEMP", "TZ", "PWD", "HOSTNAME",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
  // Windows essentials
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
  "SystemRoot", "SystemDrive", "windir", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS",
]);

export function buildAgentEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (ENV_ALLOW.has(k) || k.startsWith("CLAUDE_")) out[k] = v;
  }
  // Force the user's subscription: API-key vars must never reach the agent.
  delete out.ANTHROPIC_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  // Extra: ask Claude Code to scrub known cloud creds from any subprocess it spawns.
  out.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = "1";
  return out;
}

/* ---- Working-directory confinement ---- */
// The working dir must be a real folder inside the easyclaude projects root.
export interface CwdCheck {
  ok: boolean;
  path?: string;
  error?: string;
}

export function validateCwd(cwd: unknown): CwdCheck {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    return { ok: false, error: "Invalid folder." };
  }
  const p = resolve(cwd);
  if (!withinProjectsRoot(p)) {
    return { ok: false, error: "The folder must be inside your easyclaude folder." };
  }
  try {
    if (!statSync(p).isDirectory()) {
      return { ok: false, error: "That path is not a folder." };
    }
  } catch {
    return { ok: false, error: "That folder does not exist." };
  }
  return { ok: true, path: p };
}
