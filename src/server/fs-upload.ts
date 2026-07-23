import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { realWithinProjectsRoot } from "@/server/projects";

// User uploads from the chat composer and the orchestrator modal.
// Panel uploads land in <project>/attachments/; orchestrator uploads are
// staged under ~/.easyagent/uploads/<id>/ (the project does not exist yet at
// review time) and moved into <project>/reference/ when the plan launches.

export const MAX_UPLOAD_BYTES = 20_000_000;
export const MAX_UPLOAD_FILES = 8;
export const ATTACH_DIR = "attachments";
export const REFERENCE_DIR = "reference";

/** Document/reference formats the chat accepts (matches the user-facing pitch:
 *  PDF, Markdown, images, plus the common plain-data formats). */
export const ALLOWED_UPLOAD_EXT = new Set([
  "pdf",
  "md",
  "markdown",
  "txt",
  "csv",
  "json",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);

const UPLOADS_ROOT = join(homedir(), ".easyagent", "uploads");
const STAGING_ID_RE = /^[a-f0-9]{16,64}$/;

export interface UploadSaveResult {
  ok: boolean;
  /** Path relative to the project root (e.g. "attachments/spec.pdf"). */
  rel?: string;
  name?: string;
  error?: string;
}

/** Keep only a safe basename: no separators, no traversal, no control chars. */
// eslint-disable-next-line no-control-regex -- rejecting control chars in names is intentional
const SEG_RE = /^(?!\.\.?$)[^/\\\x00-\x1f]{1,120}$/;
export function sanitizeUploadName(nameArg: unknown): string | null {
  if (typeof nameArg !== "string") return null;
  const name = basename(nameArg.trim());
  return SEG_RE.test(name) ? name : null;
}

export function allowedUploadName(name: string): boolean {
  const ext = extname(name).slice(1).toLowerCase();
  return ALLOWED_UPLOAD_EXT.has(ext);
}

/** First free path for `name` in `dir` ("spec.pdf" → "spec-1.pdf", …). */
function uniquePath(dir: string, name: string): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = join(dir, name);
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${stem}-${i}${ext}`);
  return candidate;
}

function checkFile(nameArg: unknown, buf: Buffer): { name?: string; error?: string } {
  if (buf.length > MAX_UPLOAD_BYTES) return { error: "too-big" };
  const name = sanitizeUploadName(nameArg);
  if (!name) return { error: "invalid-name" };
  if (!allowedUploadName(name)) return { error: "invalid-type" };
  return { name };
}

/** Save one uploaded file into <project>/attachments/ (confined, collision-safe). */
export function saveAttachment(cwdArg: unknown, nameArg: unknown, buf: Buffer): UploadSaveResult {
  const { name, error } = checkFile(nameArg, buf);
  if (!name) return { ok: false, error };
  if (!realWithinProjectsRoot(cwdArg)) return { ok: false, error: "invalid-project" };
  const dir = join(resolve(cwdArg as string), ATTACH_DIR);
  try {
    if (existsSync(dir) && !statSync(dir).isDirectory()) return { ok: false, error: "not-a-dir" };
    mkdirSync(dir, { recursive: true });
    const abs = uniquePath(dir, name);
    writeFileSync(abs, buf);
    return { ok: true, rel: `${ATTACH_DIR}/${basename(abs)}`, name: basename(abs) };
  } catch {
    return { ok: false, error: "write-failed" };
  }
}

export function newStagingId(): string {
  return randomBytes(12).toString("hex");
}

/** Save one uploaded file into the staging area for a not-yet-created project. */
export function saveStaged(idArg: unknown, nameArg: unknown, buf: Buffer): UploadSaveResult {
  if (typeof idArg !== "string" || !STAGING_ID_RE.test(idArg)) return { ok: false, error: "invalid-staging" };
  const { name, error } = checkFile(nameArg, buf);
  if (!name) return { ok: false, error };
  const dir = join(UPLOADS_ROOT, idArg);
  try {
    mkdirSync(dir, { recursive: true });
    const abs = uniquePath(dir, name);
    writeFileSync(abs, buf);
    return { ok: true, name: basename(abs) };
  } catch {
    return { ok: false, error: "write-failed" };
  }
}

/** Move every staged file into <projectRoot>/reference/ and drop the staging
 *  dir. Missing/empty staging is not an error (nothing was attached). */
export function consumeStaging(idArg: unknown, projectRootArg: unknown): { ok: boolean; files: string[] } {
  if (typeof idArg !== "string" || !STAGING_ID_RE.test(idArg)) return { ok: false, files: [] };
  if (!realWithinProjectsRoot(projectRootArg)) return { ok: false, files: [] };
  const src = join(UPLOADS_ROOT, idArg);
  if (!existsSync(src)) return { ok: true, files: [] };
  const destDir = join(resolve(projectRootArg as string), REFERENCE_DIR);
  const files: string[] = [];
  try {
    mkdirSync(destDir, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const dest = uniquePath(destDir, entry.name);
      renameSync(join(src, entry.name), dest);
      files.push(`${REFERENCE_DIR}/${basename(dest)}`);
    }
    rmSync(src, { recursive: true, force: true });
    return { ok: true, files };
  } catch {
    return { ok: false, files };
  }
}
