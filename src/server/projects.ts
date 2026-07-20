import { mkdirSync, existsSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { migrateLegacyDataOnce } from "@/server/migrate-legacy";

migrateLegacyDataOnce();

/** The single home for ALL easyagent project folders. Every session's working
 *  directory must live inside this root. Kept in the user's home (outside the
 *  app's git repo, so the agent anchors paths correctly). */
export const PROJECTS_ROOT = join(homedir(), "easyagent");

export function ensureProjectsRoot(): string {
  try {
    mkdirSync(PROJECTS_ROOT, { recursive: true });
  } catch {
    /* ignore */
  }
  return PROJECTS_ROOT;
}

/** Lexical confinement check. */
export function withinProjectsRoot(p: unknown): boolean {
  if (typeof p !== "string" || p.trim() === "") return false;
  const abs = resolve(p);
  return abs === PROJECTS_ROOT || abs.startsWith(PROJECTS_ROOT + sep);
}

/** Confinement check that also resolves symlinks (for existing paths), so a
 *  symlink inside the root can't point the browser/agent outside it. */
export function realWithinProjectsRoot(p: unknown): boolean {
  if (!withinProjectsRoot(p)) return false;
  try {
    const real = realpathSync(resolve(p as string));
    return real === PROJECTS_ROOT || real.startsWith(PROJECTS_ROOT + sep);
  } catch {
    // Path doesn't exist yet (e.g. a folder about to be created) — lexical check stands.
    return true;
  }
}

const NAME_RE = /^[\w][\w \-.]{0,60}$/;

export interface MkdirResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export function createProjectFolder(parent: unknown, name: unknown): MkdirResult {
  if (!withinProjectsRoot(parent)) return { ok: false, error: "invalid-parent" };
  if (
    typeof name !== "string" ||
    !NAME_RE.test(name.trim()) ||
    name.includes("..") ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    return { ok: false, error: "invalid-name" };
  }
  const dir = join(resolve(parent as string), name.trim());
  if (!withinProjectsRoot(dir)) return { ok: false, error: "escape" };
  try {
    if (!existsSync(dir)) mkdirSync(dir);
    return { ok: true, path: dir };
  } catch {
    return { ok: false, error: "mkdir-failed" };
  }
}

function slugify(name: string): string {
  const s = (name || "project")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return s || "project";
}

/** Create a brand-new, uniquely-named project folder under the root. */
export function createProject(name: string): { ok: boolean; path?: string; name?: string } {
  ensureProjectsRoot();
  const base = slugify(name);
  let dir = join(PROJECTS_ROOT, base);
  let n = 2;
  while (existsSync(dir)) {
    dir = join(PROJECTS_ROOT, `${base}-${n++}`);
  }
  try {
    mkdirSync(dir);
    return { ok: true, path: dir, name: dir.split(sep).pop() };
  } catch {
    return { ok: false };
  }
}

/** Write a text file, confined to the projects root. */
export function writeProjectFile(filePath: unknown, content: string): boolean {
  if (!withinProjectsRoot(filePath)) return false;
  try {
    writeFileSync(resolve(filePath as string), content, "utf8");
    return true;
  } catch {
    return false;
  }
}
