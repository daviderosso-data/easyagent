import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROJECTS_ROOT, ensureProjectsRoot, createProject, realWithinProjectsRoot } from "@/server/projects";
import { scaffoldTemplate, isTemplateId } from "@/server/project-templates";

const META_DIR = join(homedir(), ".easyagent");
const META_FILE = join(META_DIR, "projects.json");

export type ProjectType = "manual" | "orchestrated";

interface Meta {
  displayName?: string;
  type?: ProjectType;
  createdAt?: number;
  lastOpenedAt?: number;
  /** Logical folder in the project manager (P6.11.4) — nothing moves on disk. */
  group?: string;
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
  group?: string;
}

/* ---- Project groups (P6.11.4): named, colored, purely logical ---- */

const GROUPS_FILE = join(META_DIR, "project-groups.json");

export interface GroupInfo {
  name: string;
  /** Panel-palette color id (lib/panel-colors), undefined = neutral. */
  color?: string;
}

function loadGroups(): GroupInfo[] {
  try {
    const raw = JSON.parse(readFileSync(GROUPS_FILE, "utf8"));
    return Array.isArray(raw) ? raw.filter((g) => typeof g?.name === "string" && g.name.trim()) : [];
  } catch {
    return [];
  }
}
function saveGroups(groups: GroupInfo[]): void {
  try {
    mkdirSync(META_DIR, { recursive: true });
    writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2), "utf8");
  } catch {
    /* best effort */
  }
}

const validGroupName = (n: unknown): n is string => typeof n === "string" && n.trim().length > 0 && n.length <= 40;

export function listGroups(): GroupInfo[] {
  return loadGroups();
}

/** Create a group or update its color. */
export function upsertGroup(name: unknown, color?: unknown): boolean {
  if (!validGroupName(name)) return false;
  const clean = name.trim();
  const groups = loadGroups();
  const existing = groups.find((g) => g.name === clean);
  const c = typeof color === "string" && color ? color : undefined;
  if (existing) existing.color = c ?? existing.color;
  else groups.push({ name: clean, ...(c ? { color: c } : {}) });
  saveGroups(groups);
  return true;
}

export function renameGroup(from: unknown, to: unknown): boolean {
  if (!validGroupName(from) || !validGroupName(to)) return false;
  const groups = loadGroups();
  const g = groups.find((x) => x.name === from);
  if (!g || groups.some((x) => x.name === to.trim())) return false;
  g.name = to.trim();
  saveGroups(groups);
  const meta = loadMeta();
  for (const m of Object.values(meta)) if (m.group === from) m.group = to.trim();
  saveMeta(meta);
  return true;
}

/** Deleting a group only ungroups its projects — nothing else is touched. */
export function deleteGroup(name: unknown): boolean {
  if (!validGroupName(name)) return false;
  saveGroups(loadGroups().filter((g) => g.name !== name));
  const meta = loadMeta();
  for (const m of Object.values(meta)) if (m.group === name) delete m.group;
  saveMeta(meta);
  return true;
}

export function setProjectGroup(folder: unknown, group: unknown): boolean {
  if (!validFolderName(folder)) return false;
  if (group !== null && !validGroupName(group)) return false;
  if (!existsSync(join(PROJECTS_ROOT, folder))) return false;
  if (group !== null && !loadGroups().some((g) => g.name === group.trim())) return false;
  const meta = loadMeta();
  const cur = { ...(meta[folder] ?? {}) };
  if (group === null) delete cur.group;
  else cur.group = group.trim();
  meta[folder] = cur;
  saveMeta(meta);
  return true;
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
    const type: ProjectType =
      m.type ??
      (existsSync(join(path, "easyagent-plan.md")) || existsSync(join(path, "easyclaude-plan.md"))
        ? "orchestrated"
        : "manual");
    out.push({
      folder,
      displayName: m.displayName ?? folder,
      path,
      type,
      createdAt: createdAt!,
      lastOpenedAt: m.lastOpenedAt ?? createdAt!,
      ...(m.group ? { group: m.group } : {}),
    });
  }
  out.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return out;
}

export function createProjectMeta(
  name: string,
  template?: unknown,
): { ok: boolean; project?: ProjectInfo; error?: string } {
  const res = createProject(name);
  if (!res.ok || !res.path || !res.name) return { ok: false, error: "create-failed" };
  const meta = loadMeta();
  const now = Date.now();
  const displayName = name.trim() || res.name;
  meta[res.name] = { displayName, type: "manual", createdAt: now, lastOpenedAt: now };
  saveMeta(meta);
  // Scaffold starter files (skips the "empty"-only README when no template given).
  if (isTemplateId(template)) scaffoldTemplate(res.path, displayName, template);
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
