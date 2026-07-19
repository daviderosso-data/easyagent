import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { startStaticServer } from "@/server/static-server";
import { PROJECTS_ROOT } from "@/server/projects";

const WS = join(PROJECTS_ROOT, "static-server-test");
const OUTSIDE = join(homedir(), "easyclaude-static-escape.txt");
let srv: { close: () => void; port: number; url: string };

beforeAll(async () => {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(join(WS, "sub"), { recursive: true });
  writeFileSync(join(WS, "index.html"), "<h1>home</h1>");
  writeFileSync(join(WS, "sub", "style.css"), "body{}");
  writeFileSync(OUTSIDE, "secret");
  symlinkSync(OUTSIDE, join(WS, "leak.txt"));
  srv = await startStaticServer(WS);
});
afterAll(() => {
  srv?.close();
  rmSync(WS, { recursive: true, force: true });
  rmSync(OUTSIDE, { force: true });
});

const get = (path: string) => fetch(`${srv.url}${path}`);

describe("static preview server", () => {
  it("serves index.html at / with the right mime", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toBe("<h1>home</h1>");
  });

  it("serves nested files with correct content-type", async () => {
    const r = await get("/sub/style.css");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/css");
  });

  it("blocks path traversal in all encodings", async () => {
    for (const p of ["/../easyclaude-static-escape.txt", "/%2e%2e%2fescape", "/..%2f..%2fetc%2fpasswd"]) {
      const r = await get(p);
      expect([400, 404]).toContain(r.status);
    }
    const nul = await get("/%00index.html");
    expect([400, 404]).toContain(nul.status);
  });

  it("refuses symlinks escaping the root", async () => {
    expect((await get("/leak.txt")).status).toBe(404);
  });

  it("404s on missing files", async () => {
    expect((await get("/nope.js")).status).toBe(404);
  });
});
