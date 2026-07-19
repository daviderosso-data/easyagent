import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { PROJECTS_ROOT, realWithinProjectsRoot, withinProjectsRoot } from "@/server/projects";
import { IGNORE, isBinaryBuffer } from "@/server/fs-browse";

// Write-capable, confined filesystem operations for the in-app file manager.
// Every mutation stays inside ~/easyclaude (symlink-safe) and validates the
// affected name. Deletes are SOFT — moved to ~/.easyclaude/.trash — so an
// accidental delete (by the user or the agent's UI) is recoverable.

const TRASH_DIR = join(homedir(), ".easyclaude", ".trash");
const MAX_WRITE_BYTES = 5_000_000;
const MAX_SEARCH_FILE_BYTES = 500_000;
const MAX_SCAN_FILES = 5000;
const MAX_HITS = 200;

export interface MutateResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/** A single path segment (file/folder name): no separators, no traversal,
 *  no control chars. Dotfiles (.env, .gitignore) are allowed. */
// eslint-disable-next-line no-control-regex -- rejecting control chars in names is intentional
const SEG_RE = /^(?!\.\.?$)[^/\\\x00-\x1f]{1,120}$/;
function validName(name: unknown): name is string {
  return typeof name === "string" && SEG_RE.test(name);
}

/** Resolve a target path for a NEW or existing file/folder: it must be lexically
 *  inside the root, have a valid basename, and sit in a real directory that is
 *  itself inside the root (symlink-safe). Returns the absolute path or null. */
function safeTarget(p: unknown): string | null {
  if (typeof p !== "string" || p.trim() === "") return null;
  const abs = resolve(p);
  if (!withinProjectsRoot(abs)) return null;
  if (!validName(basename(abs))) return null;
  const parent = dirname(abs);
  if (!realWithinProjectsRoot(parent)) return null;
  try {
    if (!statSync(parent).isDirectory()) return null;
  } catch {
    return null;
  }
  return abs;
}

export function writeFileInProject(path: unknown, content: unknown): MutateResult {
  if (typeof content !== "string") return { ok: false, error: "invalid-content" };
  if (content.length > MAX_WRITE_BYTES) return { ok: false, error: "too-big" };
  const abs = safeTarget(path);
  if (!abs) return { ok: false, error: "invalid-path" };
  try {
    if (existsSync(abs) && !statSync(abs).isFile()) return { ok: false, error: "not-a-file" };
    writeFileSync(abs, content, "utf8");
    return { ok: true, path: abs };
  } catch {
    return { ok: false, error: "write-failed" };
  }
}

/** Create an empty file (fails if it already exists). */
export function createFileInProject(parent: unknown, name: unknown): MutateResult {
  if (!realWithinProjectsRoot(parent)) return { ok: false, error: "invalid-parent" };
  if (!validName(name)) return { ok: false, error: "invalid-name" };
  const abs = join(resolve(parent as string), name);
  if (!withinProjectsRoot(abs)) return { ok: false, error: "escape" };
  if (existsSync(abs)) return { ok: false, error: "exists" };
  try {
    writeFileSync(abs, "", { encoding: "utf8", flag: "wx" });
    return { ok: true, path: abs };
  } catch {
    return { ok: false, error: "create-failed" };
  }
}

export function renameEntry(path: unknown, newName: unknown): MutateResult {
  if (!realWithinProjectsRoot(path)) return { ok: false, error: "invalid-source" };
  const src = resolve(path as string);
  if (src === PROJECTS_ROOT) return { ok: false, error: "cannot-rename-root" };
  if (!validName(newName)) return { ok: false, error: "invalid-name" };
  const dest = safeTarget(join(dirname(src), newName as string));
  if (!dest) return { ok: false, error: "invalid-dest" };
  if (existsSync(dest)) return { ok: false, error: "exists" };
  try {
    renameSync(src, dest);
    return { ok: true, path: dest };
  } catch {
    return { ok: false, error: "rename-failed" };
  }
}

export function moveEntry(path: unknown, destDir: unknown): MutateResult {
  if (!realWithinProjectsRoot(path)) return { ok: false, error: "invalid-source" };
  const src = resolve(path as string);
  if (src === PROJECTS_ROOT) return { ok: false, error: "cannot-move-root" };
  if (!realWithinProjectsRoot(destDir)) return { ok: false, error: "invalid-dest" };
  const dir = resolve(destDir as string);
  try {
    if (!statSync(dir).isDirectory()) return { ok: false, error: "dest-not-dir" };
  } catch {
    return { ok: false, error: "dest-missing" };
  }
  const dest = join(dir, basename(src));
  // Refuse moving a folder into itself or a descendant.
  if (dest === src || dest.startsWith(src + sep)) return { ok: false, error: "into-self" };
  if (existsSync(dest)) return { ok: false, error: "exists" };
  try {
    renameSync(src, dest);
    return { ok: true, path: dest };
  } catch {
    return { ok: false, error: "move-failed" };
  }
}

/** Soft-delete: move the entry to ~/.easyclaude/.trash (recoverable). */
export function deleteEntry(path: unknown): MutateResult {
  if (!realWithinProjectsRoot(path)) return { ok: false, error: "invalid-source" };
  const src = resolve(path as string);
  if (src === PROJECTS_ROOT) return { ok: false, error: "cannot-delete-root" };
  try {
    mkdirSync(TRASH_DIR, { recursive: true });
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const dest = join(TRASH_DIR, `${stamp}-${basename(src)}`);
    renameSync(src, dest);
    return { ok: true, path: dest };
  } catch {
    // Cross-device or trash unavailable → hard delete as a last resort.
    try {
      rmSync(src, { recursive: true, force: true });
      return { ok: true };
    } catch {
      return { ok: false, error: "delete-failed" };
    }
  }
}

export interface SearchHit {
  path: string;
  name: string;
  isDir: boolean;
  line?: number;
  preview?: string;
}
export interface SearchResult {
  ok: boolean;
  hits?: SearchHit[];
  truncated?: boolean;
}

/** Bounded, confined search over a project subtree: matches file/folder names
 *  and (for text files) the first matching line per file. */
export function searchFiles(rootArg: unknown, queryArg: unknown): SearchResult {
  if (!realWithinProjectsRoot(rootArg)) return { ok: false };
  const root = resolve(rootArg as string);
  const q = typeof queryArg === "string" ? queryArg.trim() : "";
  if (q.length < 2) return { ok: true, hits: [] };
  const ql = q.toLowerCase();
  const hits: SearchHit[] = [];
  let scanned = 0;
  let truncated = false;
  const stack: string[] = [root];

  while (stack.length) {
    if (hits.length >= MAX_HITS || scanned >= MAX_SCAN_FILES) {
      truncated = true;
      break;
    }
    const dir = stack.pop()!;
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (IGNORE.has(e.name) || e.name.startsWith("._")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        if (e.name.toLowerCase().includes(ql)) hits.push({ path: p, name: e.name, isDir: true });
        continue;
      }
      scanned++;
      if (e.name.toLowerCase().includes(ql)) hits.push({ path: p, name: e.name, isDir: false });
      try {
        const st = statSync(p);
        if (st.size > MAX_SEARCH_FILE_BYTES) continue;
        const buf = readFileSync(p);
        if (isBinaryBuffer(buf)) continue;
        const lines = buf.toString("utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(ql)) {
            hits.push({ path: p, name: e.name, isDir: false, line: i + 1, preview: lines[i].trim().slice(0, 200) });
            break;
          }
        }
      } catch {
        /* unreadable file — skip */
      }
      if (hits.length >= MAX_HITS) {
        truncated = true;
        break;
      }
    }
  }
  return { ok: true, hits: hits.slice(0, MAX_HITS), truncated };
}
