import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import {
  MAX_UPLOAD_BYTES,
  consumeStaging,
  newStagingId,
  sanitizeUploadName,
  allowedUploadName,
  saveAttachment,
  saveStaged,
} from "@/server/fs-upload";

const ROOT = join(homedir(), "easyagent");
const WS = join(ROOT, "fs-upload-test");
const UPLOADS = join(homedir(), ".easyagent", "uploads");

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });
});
afterAll(() => {
  rmSync(WS, { recursive: true, force: true });
});

describe("name validation", () => {
  it("keeps a plain name and strips any directory part", () => {
    expect(sanitizeUploadName("report.pdf")).toBe("report.pdf");
    expect(sanitizeUploadName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeUploadName("a/b/c.md")).toBe("c.md");
  });

  it("rejects traversal-only and control-char names", () => {
    expect(sanitizeUploadName("..")).toBeNull();
    expect(sanitizeUploadName("bad\x00name.md")).toBeNull();
    expect(sanitizeUploadName("")).toBeNull();
  });

  it("enforces the format allowlist", () => {
    for (const good of ["a.pdf", "b.md", "c.PNG", "d.jpeg", "e.json"]) expect(allowedUploadName(good)).toBe(true);
    for (const bad of ["run.sh", "app.exe", "x.html", "noext"]) expect(allowedUploadName(bad)).toBe(false);
  });
});

describe("saveAttachment", () => {
  it("saves into <project>/attachments/ and reports the relative path", () => {
    const r = saveAttachment(WS, "spec.md", Buffer.from("# spec"));
    expect(r.ok).toBe(true);
    expect(r.rel).toBe("attachments/spec.md");
    expect(readFileSync(join(WS, "attachments", "spec.md"), "utf8")).toBe("# spec");
  });

  it("never overwrites: same name gets a -1 suffix", () => {
    saveAttachment(WS, "a.md", Buffer.from("one"));
    const r = saveAttachment(WS, "a.md", Buffer.from("two"));
    expect(r.rel).toBe("attachments/a-1.md");
    expect(readFileSync(join(WS, "attachments", "a.md"), "utf8")).toBe("one");
  });

  it("rejects disallowed types, oversized files and escaped projects", () => {
    expect(saveAttachment(WS, "evil.sh", Buffer.from("x")).error).toBe("invalid-type");
    expect(saveAttachment(WS, "big.md", Buffer.alloc(MAX_UPLOAD_BYTES + 1)).error).toBe("too-big");
    expect(saveAttachment("/etc", "a.md", Buffer.from("x")).ok).toBe(false);
    expect(saveAttachment(join(homedir(), "outside"), "a.md", Buffer.from("x")).ok).toBe(false);
  });
});

describe("staging", () => {
  it("stages files and moves them into <project>/reference/ on consume", () => {
    const id = newStagingId();
    expect(saveStaged(id, "brief.pdf", Buffer.from("pdf")).ok).toBe(true);
    expect(saveStaged(id, "notes.md", Buffer.from("md")).ok).toBe(true);
    const c = consumeStaging(id, WS);
    expect(c.ok).toBe(true);
    expect(c.files.sort()).toEqual(["reference/brief.pdf", "reference/notes.md"]);
    expect(readdirSync(join(WS, "reference")).sort()).toEqual(["brief.pdf", "notes.md"]);
    expect(existsSync(join(UPLOADS, id))).toBe(false);
  });

  it("rejects malformed staging ids (no traversal into ~/.easyagent)", () => {
    expect(saveStaged("../evil", "a.md", Buffer.from("x")).ok).toBe(false);
    expect(consumeStaging("../evil", WS).ok).toBe(false);
    expect(consumeStaging("UPPER-not-hex", WS).ok).toBe(false);
  });

  it("consuming a missing staging id is a harmless no-op", () => {
    const c = consumeStaging(newStagingId(), WS);
    expect(c.ok).toBe(true);
    expect(c.files).toEqual([]);
  });

  it("refuses to consume into a folder outside the projects root", () => {
    const id = newStagingId();
    saveStaged(id, "a.md", Buffer.from("x"));
    expect(consumeStaging(id, "/tmp").ok).toBe(false);
    rmSync(join(UPLOADS, id), { recursive: true, force: true });
  });
});
