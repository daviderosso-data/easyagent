import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { skipSetup } from "@/server/auth";

// P7 added an auth gate to the proxy; park it in the "skipped" state so these
// tests keep exercising only the origin guard (see proxy-auth.test.ts).
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ea-origin-"));
  process.env.EASYAGENT_DIR = dir;
  skipSetup();
});
afterAll(() => {
  delete process.env.EASYAGENT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function req(headers: Record<string, string>, method = "GET"): NextRequest {
  return new NextRequest("http://localhost:3000/", { method, headers });
}

const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

describe("proxy origin guard", () => {
  it("allows a plain same-origin request", () => {
    expect(proxy(req({ host: "localhost:3000", "sec-fetch-site": "same-origin" })).status).toBe(200);
  });

  it("rejects a non-loopback host", () => {
    expect(proxy(req({ host: "evil.example" })).status).toBe(403);
  });

  it("allows a cross-site top-level GET navigation (link into the app)", () => {
    expect(proxy(req({ host: "localhost:3000", "sec-fetch-site": "cross-site", ...NAV })).status).toBe(200);
    expect(
      proxy(req({ host: "localhost:3000", "sec-fetch-site": "cross-site", referer: "https://github.com/", ...NAV })).status
    ).toBe(200);
  });

  it("rejects cross-site fetch/subresource requests", () => {
    expect(
      proxy(req({ host: "localhost:3000", "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })).status
    ).toBe(403);
  });

  it("rejects a cross-site POST even in navigate mode (form CSRF)", () => {
    expect(proxy(req({ host: "localhost:3000", "sec-fetch-site": "cross-site", ...NAV }, "POST")).status).toBe(403);
  });

  it("rejects cross-site embed/object navigations", () => {
    expect(
      proxy(req({ host: "localhost:3000", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "embed" })).status
    ).toBe(403);
  });

  it("still applies Origin/Referer checks to legacy requests without fetch metadata", () => {
    expect(proxy(req({ host: "localhost:3000", origin: "https://evil.example" })).status).toBe(403);
    expect(proxy(req({ host: "localhost:3000", referer: "https://evil.example/x" })).status).toBe(403);
    expect(proxy(req({ host: "localhost:3000", origin: "http://localhost:3000" }, "POST")).status).toBe(200);
  });
});
