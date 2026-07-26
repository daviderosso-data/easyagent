// P7 — app-level authentication: optional password (scrypt) + cookie sessions.
// State lives in ~/.easyagent (auth.json, auth-sessions.json), both mode 0600.
// The proxy gates every route on this; nothing here touches the engine layer.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Overridable so tests (and manual verification) never touch the real dir.
const dir = () => process.env.EASYAGENT_DIR || join(homedir(), ".easyagent");
const authFile = () => join(dir(), "auth.json");
const sessFile = () => join(dir(), "auth-sessions.json");

interface AuthRecord {
  /** scrypt(password) hex — absent until a password is set. */
  hash?: string;
  salt?: string;
  /** True once the user chose "continue without a password" at first run. */
  skipped?: boolean;
  createdAt?: number;
}
type SessionMap = Record<string, { createdAt: number; expiresAt: number }>;

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;
export const SESSION_COOKIE = "ccw_session";
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 days
const RENEW_BELOW = 20 * 24 * 3600 * 1000; // sliding renewal threshold
const MAX_SESSIONS = 20;
export const MIN_PASSWORD = 8;

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(path: string, value: unknown): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
}

/* ---- Password ---- */

const hashPassword = (pw: string, saltHex: string) =>
  scryptSync(pw, Buffer.from(saltHex, "hex"), KEYLEN, SCRYPT).toString("hex");

export function authState(): { configured: boolean; skipped: boolean } {
  const a = readJson<AuthRecord>(authFile(), {});
  return { configured: !!(a.hash && a.salt), skipped: !!a.skipped };
}

const validPassword = (pw: unknown): pw is string =>
  typeof pw === "string" && pw.length >= MIN_PASSWORD && pw.length <= 200;

/** First-time setup. Refused once a password exists (change goes through changePassword). */
export function setupPassword(pw: unknown): boolean {
  if (!validPassword(pw) || authState().configured) return false;
  const salt = randomBytes(16).toString("hex");
  writeJson(authFile(), { hash: hashPassword(pw, salt), salt, createdAt: Date.now() } satisfies AuthRecord);
  return true;
}

/** First-run "continue without a password" — remembered so the prompt shows once. */
export function skipSetup(): boolean {
  if (authState().configured) return false;
  writeJson(authFile(), { skipped: true } satisfies AuthRecord);
  return true;
}

export function verifyPassword(pw: unknown): boolean {
  const a = readJson<AuthRecord>(authFile(), {});
  if (!a.hash || !a.salt || typeof pw !== "string" || pw.length === 0 || pw.length > 200) return false;
  const expected = Buffer.from(a.hash, "hex");
  const got = Buffer.from(hashPassword(pw, a.salt), "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function changePassword(current: unknown, next: unknown): boolean {
  if (!verifyPassword(current) || !validPassword(next)) return false;
  const salt = randomBytes(16).toString("hex");
  writeJson(authFile(), { hash: hashPassword(next, salt), salt, createdAt: Date.now() } satisfies AuthRecord);
  revokeAllSessions();
  return true;
}

/** Back to the passwordless state (still counts as "prompt answered"). */
export function removePassword(current: unknown): boolean {
  if (!verifyPassword(current)) return false;
  writeJson(authFile(), { skipped: true } satisfies AuthRecord);
  revokeAllSessions();
  return true;
}

/* ---- Sessions ---- */
// The cookie holds a random 256-bit id; the file stores only its SHA-256, so
// reading the file never yields a usable session.

const digest = (id: string) => createHash("sha256").update(id).digest("hex");

export function createSession(now = Date.now()): string {
  const id = randomBytes(32).toString("hex");
  const all = readJson<SessionMap>(sessFile(), {});
  const alive = Object.entries(all).filter(([, s]) => s.expiresAt > now);
  alive.sort((a, b) => b[1].createdAt - a[1].createdAt);
  const next = Object.fromEntries(alive.slice(0, MAX_SESSIONS - 1));
  next[digest(id)] = { createdAt: now, expiresAt: now + SESSION_TTL };
  writeJson(sessFile(), next);
  return id;
}

export function sessionValid(id: string | undefined | null, renew = false, now = Date.now()): boolean {
  if (!id || !/^[0-9a-f]{64}$/.test(id)) return false;
  const all = readJson<SessionMap>(sessFile(), {});
  const s = all[digest(id)];
  if (!s || s.expiresAt <= now) return false;
  if (renew && s.expiresAt - now < RENEW_BELOW) {
    s.expiresAt = now + SESSION_TTL;
    writeJson(sessFile(), all);
  }
  return true;
}

export function revokeSession(id: string | undefined | null): void {
  if (!id) return;
  const all = readJson<SessionMap>(sessFile(), {});
  if (delete all[digest(id)]) writeJson(sessFile(), all);
}

export function revokeAllSessions(): void {
  if (existsSync(sessFile())) writeJson(sessFile(), {});
}

/* ---- Cookie helpers (route handlers use plain Set-Cookie headers) ---- */

// Secure when this process serves TLS itself, or when a reverse proxy in front
// of it terminates https (server deployments — see EASYAGENT_PUBLIC_ORIGIN).
const secure = () =>
  process.env.EASYAGENT_HTTPS === "1" || process.env.EASYAGENT_PUBLIC_ORIGIN?.trim().startsWith("https:")
    ? "; Secure"
    : "";

export function sessionSetCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure()}`;
}
export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure()}`;
}

/** Read the session id from a standard Request's Cookie header. */
export function readSessionId(req: Request): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v;
  }
  return undefined;
}

/* ---- Login rate limit (single user → one global gate) ---- */
// 5 free attempts, then 30s doubling per failure, capped at 15 minutes.

let failCount = 0;
let blockedUntil = 0;

export function loginGate(now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  if (now < blockedUntil) return { ok: false, retryAfter: Math.ceil((blockedUntil - now) / 1000) };
  return { ok: true };
}

export function noteLogin(ok: boolean, now = Date.now()): void {
  if (ok) {
    failCount = 0;
    blockedUntil = 0;
    return;
  }
  failCount++;
  if (failCount >= 5) blockedUntil = now + Math.min(900_000, 30_000 * 2 ** (failCount - 5));
}

export function resetLoginGateForTests(): void {
  failCount = 0;
  blockedUntil = 0;
}
