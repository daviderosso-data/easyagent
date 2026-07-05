import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { realWithinProjectsRoot, PROJECTS_ROOT } from "@/server/projects";

const IGNORE = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".turbo", ".cache", ".DS_Store", "coverage",
]);
const MAX_FILE_BYTES = 500_000;

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
}

export function readFileSafe(path: unknown): FileResult {
  if (!realWithinProjectsRoot(path)) return { ok: false };
  const abs = resolve(path as string);
  try {
    const st = statSync(abs);
    if (!st.isFile()) return { ok: false };
    if (st.size > MAX_FILE_BYTES) return { ok: true, path: abs, name: basename(abs), content: "", tooBig: true };
    return { ok: true, path: abs, name: basename(abs), content: readFileSync(abs, "utf8"), tooBig: false };
  } catch {
    return { ok: false };
  }
}
