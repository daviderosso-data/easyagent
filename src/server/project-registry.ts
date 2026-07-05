import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROJECTS_ROOT, ensureProjectsRoot, createProject, realWithinProjectsRoot } from "@/server/projects";

const META_DIR = join(homedir(), ".easyclaude");
const META_FILE = join(META_DIR, "projects.json");

export type ProjectType = "manual" | "orchestrated";

interface Meta {
  displayName?: string;
  type?: ProjectType;
  createdAt?: number;
  lastOpenedAt?: number;
}
type MetaMap = Record<string, Meta>; // keyed by folder name

function loadMeta(): MetaMap {
  try {
    return JSON.parse(readFileSync(META_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveMeta(m: MetaMap): void {
  try {
    mkdirSync(META_DIR, { recursive: true });
    writeFileSync(META_FILE, JSON.stringify(m, null, 2), "utf8");
  } catch {
    /* best effort */
  }
}

export interface ProjectInfo {
  folder: string;
  displayName: string;
  path: string;
  type: ProjectType;
  createdAt: number;
  lastOpenedAt: number;
}

/** Top-level folders under the projects root, enriched with metadata. */
export function listProjects(): ProjectInfo[] {
  ensureProjectsRoot();
  const meta = loadMeta();
  let dirents: import("node:fs").Dirent[] = [];
  try {
    dirents = readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    /* ignore */
  }
  const out: ProjectInfo[] = [];
  for (const d of dirents) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const folder = d.name;
    const path = join(PROJECTS_ROOT, folder);
    const m = meta[folder] ?? {};
    let createdAt = m.createdAt;
    if (!createdAt) {
      try {
        const st = statSync(path);
        createdAt = st.birthtimeMs || st.mtimeMs;
      } catch {
        createdAt = Date.now();
      }
    }
    const type: ProjectType = m.type ?? (existsSync(join(path, "easyclaude-plan.md")) ? "orchestrated" : "manual");
    out.push({
      folder,
      displayName: m.displayName ?? folder,
      path,
      type,
      createdAt: createdAt!,
      lastOpenedAt: m.lastOpenedAt ?? createdAt!,
    });
  }
  out.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return out;
}

export function createProjectMeta(name: string): { ok: boolean; project?: ProjectInfo; error?: string } {
  const res = createProject(name);
  if (!res.ok || !res.path || !res.name) return { ok: false, error: "create-failed" };
  const meta = loadMeta();
  const now = Date.now();
  const displayName = name.trim() || res.name;
  meta[res.name] = { displayName, type: "manual", createdAt: now, lastOpenedAt: now };
  saveMeta(meta);
  return { ok: true, project: { folder: res.name, displayName, path: res.path, type: "manual", createdAt: now, lastOpenedAt: now } };
}

function validFolderName(folder: unknown): folder is string {
  return typeof folder === "string" && folder.length > 0 && !folder.includes("/") && !folder.includes("\\") && !folder.includes("..");
}

export function renameProject(folder: unknown, displayName: unknown): boolean {
  if (!validFolderName(folder) || typeof displayName !== "string" || !displayName.trim()) return false;
  const path = join(PROJECTS_ROOT, folder);
  if (!existsSync(path)) return false;
  const meta = loadMeta();
  meta[folder] = { ...(meta[folder] ?? {}), displayName: displayName.trim() };
  saveMeta(meta);
  return true;
}

export function touchProject(folder: unknown): void {
  if (!validFolderName(folder)) return;
  const path = join(PROJECTS_ROOT, folder);
  if (!existsSync(path)) return;
  const meta = loadMeta();
  meta[folder] = { ...(meta[folder] ?? {}), lastOpenedAt: Date.now() };
  saveMeta(meta);
}

export function deleteProject(folder: unknown): boolean {
  if (!validFolderName(folder)) return false;
  const path = join(PROJECTS_ROOT, folder);
  // Must be a real top-level child of the root, never the root itself.
  if (path === PROJECTS_ROOT || !realWithinProjectsRoot(path) || !existsSync(path)) return false;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    return false;
  }
  const meta = loadMeta();
  delete meta[folder];
  saveMeta(meta);
  return true;
}

/** Called by the orchestrator so its projects show the "orchestrated" badge. */
export function markOrchestrated(folder: string, displayName: string): void {
  if (!validFolderName(folder)) return;
  const meta = loadMeta();
  const now = Date.now();
  meta[folder] = {
    displayName: meta[folder]?.displayName ?? displayName,
    type: "orchestrated",
    createdAt: meta[folder]?.createdAt ?? now,
    lastOpenedAt: now,
  };
  saveMeta(meta);
}
