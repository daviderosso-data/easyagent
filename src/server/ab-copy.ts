// P6.9.4 follow-up: variant B of an A/B comparison works on a COPY of the
// project, so both engines can write the same filenames without clobbering
// each other. The copy lives inside the project (ab-<engine>/) so both
// versions sit in one file tree, and Undo/save points cover it too.

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { projectRootFor } from "@/server/snapshots";

// Heavy/derived folders never worth duplicating (same spirit as the snapshot
// excludes), checked at every depth by basename.
const COPY_EXCLUDES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".DS_Store",
]);

/** ab-* folders at the project root are comparison copies — never copy them
 *  into a new copy (no matryoshka comparisons). */
const AB_DIR_RE = /^ab-/;

export function createAbCopy(cwd: string, provider: string): { ok: boolean; path?: string; error?: string } {
  const root = projectRootFor(cwd);
  if (!root) return { ok: false, error: "bad-folder" };
  const slug =
    (provider || "b")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "b";
  let name = `ab-${slug}`;
  for (let n = 2; existsSync(join(root, name)); n++) name = `ab-${slug}-${n}`;
  const dest = join(root, name);
  try {
    mkdirSync(dest);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (COPY_EXCLUDES.has(entry.name)) continue;
      if (entry.isDirectory() && AB_DIR_RE.test(entry.name)) continue;
      cpSync(join(root, entry.name), join(dest, entry.name), {
        recursive: true,
        filter: (src) => !COPY_EXCLUDES.has(basename(src)),
      });
    }
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
