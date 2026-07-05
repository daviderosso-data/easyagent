import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".easyclaude");
const FILE = join(DIR, "workspace.json");

export interface WorkspacePanel {
  projectPath: string;
  selModel?: string | null;
  effort?: string;
  sessionId?: string | null;
  roleLabel?: string;
}
export interface Workspace {
  panels: WorkspacePanel[];
  activeIndex: number;
}

export function loadWorkspace(): Workspace {
  try {
    const w = JSON.parse(readFileSync(FILE, "utf8"));
    if (Array.isArray(w?.panels)) return { panels: w.panels, activeIndex: w.activeIndex ?? 0 };
  } catch {
    /* ignore */
  }
  return { panels: [], activeIndex: 0 };
}

export function saveWorkspace(w: Workspace): void {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(w, null, 2), "utf8");
  } catch {
    /* best effort */
  }
}
