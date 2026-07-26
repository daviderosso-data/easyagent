// P7.1 — remote access: the preconditions that gate it, and how the proxy's
// origin guard changes once the app serves beyond loopback.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { createSession, setupPassword, SESSION_COOKIE } from "@/server/auth";
import { remoteEnabled, remotePreconditions } from "@/server/remote";

let dir: string;

/** Write settings.json + optionally a certificate, mirroring the real layout. */
function configure(opts: { https?: boolean; remote?: boolean; cert?: boolean }) {
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ lang: "en", theme: "system", model: null, cwd: null, notifications: false, https: !!opts.https, remote: !!opts.remote }),
  );
  if (opts.cert) {
    mkdirSync(join(dir, "tls"), { recursive: true });
    writeFileSync(join(dir, "tls", "cert.pem"), "x");
    writeFileSync(join(dir, "tls", "key.pem"), "x");
  } else {
    rmSync(join(dir, "tls"), { recursive: true, force: true });
  }
}

function req(path: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://192.168.1.50:3000${path}`, { headers });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ea-remote-"));
  process.env.EASYAGENT_DIR = dir;
});
afterEach(() => {
  delete process.env.EASYAGENT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("preconditions", () => {
  it("needs both a password and a certificate", () => {
    expect(remotePreconditions()).toMatchObject({ ok: false, needPassword: true, needTls: true });
    setupPassword("longenough");
    expect(remotePreconditions()).toMatchObject({ ok: false, needPassword: false, needTls: true });
    configure({ cert: true });
    expect(remotePreconditions().ok).toBe(true);
  });

  it("remoteEnabled stays false unless flag + https + password + cert all hold", () => {
    configure({ remote: true, https: true, cert: true });
    expect(remoteEnabled()).toBe(false); // no password yet

    setupPassword("longenough");
    expect(remoteEnabled()).toBe(true);

    // A hand-edited settings file that drops https must not open the door.
    configure({ remote: true, https: false, cert: true });
    expect(remoteEnabled()).toBe(false);

    // Neither may a deleted certificate.
    configure({ remote: true, https: true, cert: false });
    expect(remoteEnabled()).toBe(false);
  });
});

describe("remote approval flow", () => {
  it("lists approvals from turns this client never started, and decides them", async () => {
    const { sessionManager } = await import("@/server/session-manager");
    const { POST } = await import("@/app/api/chat/approve/route");
    const { SESSION_TOKEN } = await import("@/server/security");

    const turn = sessionManager.tryCreate("t-remote", new AbortController(), 99)!;
    turn.project = "/Users/x/easyagent/mysite";
    turn.roleLabel = "Backend";

    let decided: { allow: boolean } | null = null;
    const emitted: unknown[] = [];
    turn.emit = (e) => emitted.push(e);
    turn.pendingApprovals.set("ap-1", {
      resolve: (d) => { decided = d; },
      meta: { approvalId: "ap-1", turnId: "t-remote", toolName: "Bash", title: "rm -rf build", risk: "red", severity: "broaddelete", askedAt: 1 },
    });

    // The phone sees it with enough context to decide, without the SSE stream.
    const listed = sessionManager.listApprovals().find((a) => a.approvalId === "ap-1");
    expect(listed).toMatchObject({ title: "rm -rf build", risk: "red", roleLabel: "Backend" });

    const res = await POST(
      new Request("http://localhost/api/chat/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ccw-token": SESSION_TOKEN },
        body: JSON.stringify({ turnId: "t-remote", approvalId: "ap-1", decision: "allow" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(decided).toEqual({ allow: true });
    // The desktop holding the SSE stream is told, so its modal disappears.
    expect(emitted).toEqual([{ type: "approval_resolved", approvalId: "ap-1", decision: "allow" }]);
    expect(sessionManager.listApprovals().some((a) => a.approvalId === "ap-1")).toBe(false);

    sessionManager.end("t-remote");
  });
});

describe("proxy with remote OFF (default)", () => {
  it("rejects a non-loopback host", () => {
    configure({});
    expect(proxy(req("/", { host: "192.168.1.50:3000" })).status).toBe(403);
  });
});

describe("proxy with remote ON", () => {
  beforeEach(() => {
    setupPassword("longenough");
    configure({ remote: true, https: true, cert: true });
  });

  it("accepts a LAN host when the session is valid", () => {
    const id = createSession();
    const r = proxy(req("/api/remote/state", { host: "192.168.1.50:3000", "sec-fetch-site": "same-origin", cookie: `${SESSION_COOKIE}=${id}` }));
    expect(r.status).toBe(200);
  });

  it("still requires authentication", () => {
    expect(proxy(req("/api/remote/state", { host: "192.168.1.50:3000", "sec-fetch-site": "same-origin" })).status).toBe(401);
    expect(proxy(req("/m", { host: "192.168.1.50:3000", "sec-fetch-site": "same-origin" })).status).toBe(307);
  });

  it("rejects an Origin that does not match the Host (CSRF from another site)", () => {
    const id = createSession();
    const r = proxy(
      req("/api/chat/approve", {
        host: "192.168.1.50:3000",
        origin: "https://evil.example",
        cookie: `${SESSION_COOKIE}=${id}`,
      }),
    );
    expect(r.status).toBe(403);
  });

  it("accepts a matching Origin", () => {
    const id = createSession();
    const r = proxy(
      req("/api/chat/approve", {
        host: "192.168.1.50:3000",
        origin: "http://192.168.1.50:3000",
        cookie: `${SESSION_COOKIE}=${id}`,
      }),
    );
    expect(r.status).toBe(200);
  });

  it("still rejects cross-site fetches", () => {
    const id = createSession();
    const r = proxy(
      req("/api/remote/state", {
        host: "192.168.1.50:3000",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors",
        cookie: `${SESSION_COOKIE}=${id}`,
      }),
    );
    expect(r.status).toBe(403);
  });
});
