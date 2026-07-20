import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// One-time migration from the old "easyclaude" name to "easyagent":
//   ~/easyclaude   (projects root)      → ~/easyagent
//   ~/.easyclaude  (config/state)       → ~/.easyagent
// plus fix-ups for state that embeds absolute paths:
//   - JSON stores (settings/workspace/projects/mcp) get their path strings rewritten
//   - save-point shadow repos are keyed by sha1(projectRoot) — re-hash their dirs
// Runs once per process (globalThis guard), called from the first server module
// that touches either directory. Never throws: a failed migration must not
// prevent the app from starting fresh.

const JSON_STORES = ["settings.json", "workspace.json", "projects.json", "mcp.json"];

export function migrateLegacyData(home: string = homedir()): void {
  const oldDot = join(home, ".easyclaude");
  const newDot = join(home, ".easyagent");
  const oldRoot = join(home, "easyclaude");
  const newRoot = join(home, "easyagent");

  try {
    if (existsSync(oldDot) && !existsSync(newDot)) renameSync(oldDot, newDot);
  } catch {
    /* keep going — worst case the app starts fresh */
  }
  try {
    if (existsSync(oldRoot) && !existsSync(newRoot)) renameSync(oldRoot, newRoot);
  } catch {
    /* ditto */
  }

  // Rewrite absolute paths embedded in the JSON stores (cwd, panels, MCP env…).
  for (const name of JSON_STORES) {
    const file = join(newDot, name);
    try {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      const next = text.split(oldRoot).join(newRoot).split(oldDot).join(newDot);
      if (next !== text) writeFileSync(file, next, "utf8");
    } catch {
      /* best effort per file */
    }
  }

  // Shadow repos live at <name>-<sha1(projectRoot)[:8]>.git — the root path
  // changed, so recompute each suffix (reconstructing the old path from the
  // folder name) and rename, keeping every project's save-point history.
  const snapDir = join(newDot, "snapshots");
  try {
    if (existsSync(snapDir)) {
      for (const entry of readdirSync(snapDir)) {
        const m = /^(.+)-([0-9a-f]{8})\.git$/.exec(entry);
        if (!m) continue;
        const [, base, suffix] = m;
        const oldHash = createHash("sha1").update(join(oldRoot, base)).digest("hex").slice(0, 8);
        if (suffix !== oldHash) continue;
        const newHash = createHash("sha1").update(join(newRoot, base)).digest("hex").slice(0, 8);
        const target = join(snapDir, `${base}-${newHash}.git`);
        if (!existsSync(target)) renameSync(join(snapDir, entry), target);
      }
    }
  } catch {
    /* best effort */
  }
}

const g = globalThis as unknown as { __ccw_migrated?: boolean };
export function migrateLegacyDataOnce(): void {
  if (g.__ccw_migrated) return;
  g.__ccw_migrated = true;
  migrateLegacyData();
}
