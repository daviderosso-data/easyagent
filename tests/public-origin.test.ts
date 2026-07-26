// P8 — server deployment behind a reverse proxy: which Host is accepted, and
// the rule that a publicly reachable app can never be left passwordless.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { createSession, setupPassword, skipSetup, sessionSetCookie, SESSION_COOKIE } from "@/server/auth";
import { publicOrigin } from "@/server/remote";

const ORIGIN = "https://agent.example.com";

function req(path: string, host: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://${host}${path}`, {
    headers: { host, "sec-fetch-site": "same-origin", ...headers },
  });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ea-pub-"));
  process.env.EASYAGENT_DIR = dir;
  process.env.EASYAGENT_PUBLIC_ORIGIN = ORIGIN;
});
afterEach(() => {
  delete process.env.EASYAGENT_DIR;
  delete process.env.EASYAGENT_PUBLIC_ORIGIN;
  rmSync(dir, { recursive: true, force: true });
});

describe("publicOrigin parsing", () => {
  it("accepts a well-formed origin and reports the scheme", () => {
    expect(publicOrigin()).toEqual({ host: "agent.example.com", secure: true });
    process.env.EASYAGENT_PUBLIC_ORIGIN = "http://box.local:8080";
    expect(publicOrigin()).toEqual({ host: "box.local:8080", secure: false });
  });

  it("ignores junk rather than half-applying it", () => {
    for (const bad of ["", "   ", "not a url", "ftp://x.example", "agent.example.com"]) {
      process.env.EASYAGENT_PUBLIC_ORIGIN = bad;
      expect(publicOrigin()).toBeNull();
    }
  });
});

describe("host acceptance", () => {
  beforeEach(() => setupPassword("longenough"));

  it("accepts the declared public host (forwarded by the reverse proxy)", () => {
    const c = `${SESSION_COOKIE}=${createSession()}`;
    expect(proxy(req("/", "agent.example.com", { cookie: c })).status).toBe(200);
  });

  it("still accepts loopback (local admin over an SSH tunnel)", () => {
    const c = `${SESSION_COOKIE}=${createSession()}`;
    expect(proxy(req("/", "127.0.0.1:3000", { cookie: c })).status).toBe(200);
  });

  it("rejects any other host", () => {
    const c = `${SESSION_COOKIE}=${createSession()}`;
    expect(proxy(req("/", "evil.example", { cookie: c })).status).toBe(403);
  });

  it("rejects a mismatched Origin on the public host", () => {
    const c = `${SESSION_COOKIE}=${createSession()}`;
    expect(proxy(req("/api/chat/approve", "agent.example.com", { cookie: c, origin: "https://evil.example" })).status).toBe(403);
    expect(proxy(req("/api/chat/approve", "agent.example.com", { cookie: c, origin: ORIGIN })).status).toBe(200);
  });
});

describe("a public deployment cannot be left passwordless", () => {
  it("serves only the setup screen until a password exists", () => {
    expect(proxy(req("/", "agent.example.com")).status).toBe(307);
    expect(proxy(req("/api/projects", "agent.example.com")).status).toBe(401);
    expect(proxy(req("/login", "agent.example.com")).status).toBe(200);
  });

  it("a prior 'skip' does NOT open it", () => {
    skipSetup(); // e.g. the box was set up locally first
    expect(proxy(req("/", "agent.example.com")).status).toBe(307);
    expect(proxy(req("/api/projects", "agent.example.com")).status).toBe(401);
  });

  it("without a public origin, skip still works (laptop behaviour unchanged)", () => {
    delete process.env.EASYAGENT_PUBLIC_ORIGIN;
    skipSetup();
    expect(proxy(req("/", "127.0.0.1:3000")).status).toBe(200);
  });
});

describe("cookies", () => {
  it("are marked Secure when the reverse proxy terminates https", () => {
    expect(sessionSetCookie("a".repeat(64))).toContain("Secure");
  });

  it("are not, on a plain-http origin", () => {
    process.env.EASYAGENT_PUBLIC_ORIGIN = "http://box.local:8080";
    expect(sessionSetCookie("a".repeat(64))).not.toContain("Secure");
  });
});
