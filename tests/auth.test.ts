// P7 — app-level auth: password lifecycle, sessions, rate limit, cookies.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authState,
  changePassword,
  createSession,
  loginGate,
  noteLogin,
  readSessionId,
  removePassword,
  resetLoginGateForTests,
  revokeAllSessions,
  revokeSession,
  sessionSetCookie,
  sessionValid,
  setupPassword,
  skipSetup,
  verifyPassword,
} from "@/server/auth";

const DAY = 24 * 3600 * 1000;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ea-auth-"));
  process.env.EASYAGENT_DIR = dir;
  resetLoginGateForTests();
});
afterEach(() => {
  delete process.env.EASYAGENT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("password lifecycle", () => {
  it("starts unconfigured and not skipped", () => {
    expect(authState()).toEqual({ configured: false, skipped: false });
  });

  it("setup + verify, wrong password rejected", () => {
    expect(setupPassword("hunter2pass")).toBe(true);
    expect(authState().configured).toBe(true);
    expect(verifyPassword("hunter2pass")).toBe(true);
    expect(verifyPassword("wrong")).toBe(false);
  });

  it("rejects short passwords and double setup", () => {
    expect(setupPassword("short")).toBe(false);
    expect(setupPassword("longenough")).toBe(true);
    expect(setupPassword("anotherpw1")).toBe(false);
  });

  it("skip is remembered; a password can still be set later", () => {
    expect(skipSetup()).toBe(true);
    expect(authState()).toEqual({ configured: false, skipped: true });
    expect(setupPassword("longenough")).toBe(true);
    expect(authState().configured).toBe(true);
  });

  it("change requires the current password and revokes sessions", () => {
    setupPassword("firstpass1");
    const id = createSession();
    expect(changePassword("nope", "secondpass")).toBe(false);
    expect(changePassword("firstpass1", "secondpass")).toBe(true);
    expect(verifyPassword("secondpass")).toBe(true);
    expect(sessionValid(id)).toBe(false);
  });

  it("remove returns to the passwordless (skipped) state", () => {
    setupPassword("firstpass1");
    expect(removePassword("wrong")).toBe(false);
    expect(removePassword("firstpass1")).toBe(true);
    expect(authState()).toEqual({ configured: false, skipped: true });
  });
});

describe("sessions", () => {
  it("create / validate / revoke", () => {
    const id = createSession();
    expect(sessionValid(id)).toBe(true);
    expect(sessionValid("deadbeef".repeat(8))).toBe(false);
    expect(sessionValid(undefined)).toBe(false);
    revokeSession(id);
    expect(sessionValid(id)).toBe(false);
  });

  it("expires after 30 days", () => {
    const now = 1_000_000;
    const id = createSession(now);
    expect(sessionValid(id, false, now + 29 * DAY)).toBe(true);
    expect(sessionValid(id, false, now + 31 * DAY)).toBe(false);
  });

  it("sliding renewal extends the expiry", () => {
    const now = 1_000_000;
    const id = createSession(now);
    expect(sessionValid(id, true, now + 15 * DAY)).toBe(true); // renews here
    expect(sessionValid(id, false, now + 40 * DAY)).toBe(true); // dead without renewal
  });

  it("revokeAllSessions kills everything", () => {
    const a = createSession();
    const b = createSession();
    revokeAllSessions();
    expect(sessionValid(a)).toBe(false);
    expect(sessionValid(b)).toBe(false);
  });

  it("the file stores only digests, never the cookie value", () => {
    const id = createSession();
    const raw = readFileSync(join(dir, "auth-sessions.json"), "utf8");
    expect(raw.includes(id)).toBe(false);
  });
});

describe("login rate limit", () => {
  it("5 free attempts, then a 30s block that doubles", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) noteLogin(false, t0);
    expect(loginGate(t0).ok).toBe(true);
    noteLogin(false, t0); // 5th failure
    const g = loginGate(t0);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.retryAfter).toBe(30);
    expect(loginGate(t0 + 31_000).ok).toBe(true);
  });

  it("a successful login resets the gate", () => {
    for (let i = 0; i < 6; i++) noteLogin(false, 0);
    noteLogin(true);
    expect(loginGate(0).ok).toBe(true);
  });
});

describe("cookie helpers", () => {
  it("readSessionId parses the Cookie header", () => {
    const req = new Request("http://localhost/", { headers: { cookie: "a=b; ccw_session=abc123; c=d" } });
    expect(readSessionId(req)).toBe("abc123");
  });

  it("the session cookie is HttpOnly + SameSite=Strict", () => {
    const c = sessionSetCookie("x".repeat(64));
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
  });
});
