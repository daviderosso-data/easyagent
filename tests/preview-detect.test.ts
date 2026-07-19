import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { detectPreview } from "@/server/preview-detect";
import { PROJECTS_ROOT } from "@/server/projects";

const WS = join(PROJECTS_ROOT, "preview-detect-test");

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });
});
afterAll(() => {
  rmSync(WS, { recursive: true, force: true });
});

const pkg = (o: object) => writeFileSync(join(WS, "package.json"), JSON.stringify(o));

describe("detectPreview", () => {
  it("prefers scripts.dev over scripts.start over index.html", () => {
    pkg({ scripts: { dev: "vite", start: "node s.js" } });
    writeFileSync(join(WS, "index.html"), "<html>");
    expect(detectPreview(WS)).toMatchObject({ kind: "node", script: "dev" });

    pkg({ scripts: { start: "node s.js" } });
    expect(detectPreview(WS)).toMatchObject({ kind: "node", script: "start" });

    pkg({ scripts: {} });
    expect(detectPreview(WS)).toEqual({ kind: "static" });
  });

  it("flags needsInstall only when deps exist and node_modules is missing", () => {
    pkg({ scripts: { dev: "vite" }, dependencies: { x: "1" } });
    expect(detectPreview(WS)).toMatchObject({ needsInstall: true });
    mkdirSync(join(WS, "node_modules"));
    expect(detectPreview(WS)).toMatchObject({ needsInstall: false });
    rmSync(join(WS, "node_modules"), { recursive: true });
    pkg({ scripts: { dev: "vite" } });
    expect(detectPreview(WS)).toMatchObject({ needsInstall: false });
  });

  it("falls back gracefully on malformed package.json", () => {
    writeFileSync(join(WS, "package.json"), "{not json");
    writeFileSync(join(WS, "index.html"), "<html>");
    expect(detectPreview(WS)).toEqual({ kind: "static" });
    rmSync(join(WS, "index.html"));
    expect(detectPreview(WS)).toEqual({ kind: "none" });
  });
});
