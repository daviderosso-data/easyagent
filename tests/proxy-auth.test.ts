// P7 — the proxy's auth gate: first-run steering, 401 vs redirect, whitelist.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { createSession, setupPassword, skipSetup, SESSION_COOKIE } from "@/server/auth";

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { host: "localhost:3000", "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}) },
  });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ea-pxy-"));
  process.env.EASYAGENT_DIR = dir;
});
afterEach(() => {
  delete process.env.EASYAGENT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("proxy auth gate", () => {
  it("first run: pages steered to /login, APIs stay open", () => {
    const r = proxy(req("/"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toContain("/login");
    expect(proxy(req("/api/projects")).status).toBe(200);
    expect(proxy(req("/login")).status).toBe(200);
  });

  it("after skip: everything open again", () => {
    skipSetup();
    expect(proxy(req("/")).status).toBe(200);
    expect(proxy(req("/api/projects")).status).toBe(200);
  });

  it("password set: APIs 401, pages redirect, auth routes whitelisted", () => {
    setupPassword("longenough");
    expect(proxy(req("/api/projects")).status).toBe(401);
    const r = proxy(req("/"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toContain("/login");
    expect(proxy(req("/login")).status).toBe(200);
    expect(proxy(req("/api/auth/status")).status).toBe(200);
    expect(proxy(req("/api/auth/login")).status).toBe(200);
    expect(proxy(req("/api/session-token")).status).toBe(200);
  });

  it("a valid session cookie passes", () => {
    setupPassword("longenough");
    const id = createSession();
    expect(proxy(req("/", `${SESSION_COOKIE}=${id}`)).status).toBe(200);
    expect(proxy(req("/api/projects", `${SESSION_COOKIE}=${id}`)).status).toBe(200);
  });

  it("a garbage cookie does not", () => {
    setupPassword("longenough");
    expect(proxy(req("/api/projects", `${SESSION_COOKIE}=zzz`)).status).toBe(401);
    expect(proxy(req("/api/projects", `${SESSION_COOKIE}=${"a".repeat(64)}`)).status).toBe(401);
  });
});
