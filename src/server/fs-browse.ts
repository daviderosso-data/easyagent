import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { realWithinProjectsRoot, PROJECTS_ROOT } from "@/server/projects";

export const IGNORE = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".turbo", ".cache", ".DS_Store", "coverage",
]);
const MAX_FILE_BYTES = 500_000;

/** Heuristic binary sniff: a NUL byte in the first 8KB means "not text". */
export function isBinaryBuffer(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}
export interface ListResult {
  ok: boolean;
  dir?: string;
  parent?: string | null;
  entries?: Entry[];
}

export function listDir(dir: unknown): ListResult {
  if (!realWithinProjectsRoot(dir)) return { ok: false };
  const abs = resolve(dir as string);
  let dirents;
  try {
    dirents = readdirSync(abs, { withFileTypes: true });
  } catch {
    return { ok: false };
  }
  const entries: Entry[] = dirents
    .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith("._"))
    .map((e) => ({ name: e.name, path: join(abs, e.name), isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  // Don't allow navigating above the projects root.
  const parent = abs === PROJECTS_ROOT ? null : dirname(abs);
  return { ok: true, dir: abs, parent, entries };
}

export interface FileResult {
  ok: boolean;
  path?: string;
  name?: string;
  content?: string;
  tooBig?: boolean;
  binary?: boolean;
  size?: number;
}

export function readFileSafe(path: unknown): FileResult {
  if (!realWithinProjectsRoot(path)) return { ok: false };
  const abs = resolve(path as string);
  try {
    const st = statSync(abs);
    if (!st.isFile()) return { ok: false };
    const base = { ok: true as const, path: abs, name: basename(abs), size: st.size };
    if (st.size > MAX_FILE_BYTES) return { ...base, content: "", tooBig: true };
    const buf = readFileSync(abs);
    if (isBinaryBuffer(buf)) return { ...base, content: "", binary: true };
    return { ...base, content: buf.toString("utf8"), tooBig: false };
  } catch {
    return { ok: false };
  }
}
