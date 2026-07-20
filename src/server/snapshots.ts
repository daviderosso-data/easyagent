import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep, isAbsolute } from "node:path";
import { PROJECTS_ROOT } from "@/server/projects";
import { SETTINGS_DIR } from "@/server/settings-store";
import { isBinaryBuffer } from "@/server/fs-browse";
import { runGit, gitAvailable, shadowEnv } from "@/server/git-exec";

export const SNAPSHOTS_DIR = join(SETTINGS_DIR, "snapshots");

// Never tracked by the shadow repo. `.git/` at any depth keeps the project's
// own repository (and any nested one) untouched and avoids gitlink entries.
const EXCLUDES = [
  ".git/",
  "node_modules/",
  ".next/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".turbo/",
  ".cache/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".DS_Store",
  "*.log",
];

export interface SavePoint {
  hash: string;
  ts: number;
  label: string;
}

export interface DiffFile {
  path: string;
  status: "modified" | "added" | "deleted";
  old: string;
  new: string;
  tooBig?: boolean;
  binary?: boolean;
}

const MAX_DIFF_FILES = 25;
const MAX_DIFF_BYTES = 200 * 1024;

/** Top-level project folder for a cwd (role panels use subfolders). Null when
 *  cwd is the projects root itself or outside it. */
export function projectRootFor(cwd: string): string | null {
  let real: string;
  try {
    real = realpathSync(cwd);
  } catch {
    return null;
  }
  const rel = relative(PROJECTS_ROOT, real);
  if (!rel || rel === "." || rel.startsWith("..") || isAbsolute(rel)) return null;
  return join(PROJECTS_ROOT, rel.split(sep)[0]);
}

export function shadowGitDir(projectRoot: string): string {
  const suffix = createHash("sha1").update(projectRoot).digest("hex").slice(0, 8);
  return join(SNAPSHOTS_DIR, `${basename(projectRoot)}-${suffix}.git`);
}

function gitArgs(projectRoot: string, args: string[]): string[] {
  // quotePath=false keeps non-ASCII filenames (accents) readable in output.
  return ["-c", "core.quotepath=false", "--git-dir", shadowGitDir(projectRoot), "--work-tree", projectRoot, ...args];
}

async function ensureShadowRepo(projectRoot: string): Promise<boolean> {
  const gitDir = shadowGitDir(projectRoot);
  if (!existsSync(gitDir)) {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    const r = await runGit(["--git-dir", gitDir, "init", "-b", "main"], { cwd: projectRoot, env: shadowEnv() });
    if (!r.ok) return false;
  }
  try {
    mkdirSync(join(gitDir, "info"), { recursive: true });
    writeFileSync(join(gitDir, "info", "exclude"), EXCLUDES.join("\n") + "\n", "utf8");
  } catch {
    /* best effort */
  }
  return true;
}

// Per-project async mutex so parallel orchestration turns serialize their
// snapshots (the 2nd/3rd then see a clean status and skip).
const gm = globalThis as unknown as { __ccw_snap_locks?: Map<string, Promise<unknown>> };
const locks = (gm.__ccw_snap_locks ??= new Map());

function withProjectLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectRoot) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(projectRoot, next.catch(() => {}));
  return next;
}

function excerpt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 72) || "…";
}

async function hasChanges(projectRoot: string): Promise<boolean> {
  const st = await runGit(gitArgs(projectRoot, ["status", "--porcelain"]), { cwd: projectRoot, env: shadowEnv() });
  return st.ok && st.stdout.trim().length > 0;
}

async function commitAll(projectRoot: string, message: string): Promise<boolean> {
  const env = shadowEnv();
  const add = await runGit(gitArgs(projectRoot, ["add", "-A"]), { cwd: projectRoot, env, timeoutMs: 60_000 });
  if (!add.ok) return false;
  const commit = await runGit(gitArgs(projectRoot, ["commit", "-m", message]), { cwd: projectRoot, env, timeoutMs: 60_000 });
  return commit.ok;
}

/** Automatic save point before an agent turn. Never throws and never fails
 *  the turn — worst case it logs and moves on. */
export async function snapshotBeforeTurn(cwd: string, prompt: string, turnId: string): Promise<void> {
  try {
    const projectRoot = projectRootFor(cwd);
    if (!projectRoot || !(await gitAvailable())) return;
    await withProjectLock(projectRoot, async () => {
      if (!(await ensureShadowRepo(projectRoot))) return;
      if (!(await hasChanges(projectRoot))) return;
      await commitAll(projectRoot, `${excerpt(prompt)}\n\nTurn: ${turnId}`);
    });
  } catch (e) {
    console.warn("[easyagent] snapshot skipped:", (e as Error).message);
  }
}

export async function listSavePoints(cwd: string): Promise<{ ok: boolean; gitMissing?: boolean; points: SavePoint[] }> {
  const projectRoot = projectRootFor(cwd);
  if (!projectRoot) return { ok: false, points: [] };
  if (!(await gitAvailable())) return { ok: true, gitMissing: true, points: [] };
  if (!existsSync(shadowGitDir(projectRoot))) return { ok: true, points: [] };
  const r = await runGit(gitArgs(projectRoot, ["log", "--format=%H%x1f%ct%x1f%s%x1e", "-n", "100"]), {
    cwd: projectRoot,
    env: shadowEnv(),
  });
  if (!r.ok) return { ok: true, points: [] };
  const points = r.stdout
    .split("\x1e")
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, ct, label] = rec.split("\x1f");
      return { hash, ts: Number(ct) * 1000, label: label ?? "" };
    })
    .filter((p) => /^[0-9a-f]{40}$/.test(p.hash) && Number.isFinite(p.ts));
  return { ok: true, points };
}

/** Changes between a save point and the CURRENT files — what going back would undo. */
export async function diffSavePoint(cwd: string, hash: string): Promise<{ ok: boolean; files: DiffFile[]; truncated?: boolean }> {
  const projectRoot = projectRootFor(cwd);
  if (!projectRoot || !(await gitAvailable()) || !existsSync(shadowGitDir(projectRoot))) return { ok: false, files: [] };
  const env = shadowEnv();
  const r = await runGit(gitArgs(projectRoot, ["diff", "--name-status", hash]), { cwd: projectRoot, env });
  if (!r.ok) return { ok: false, files: [] };

  // Files created since the last save point are untracked and invisible to
  // `diff <hash>` — but a restore would remove them, so list them as added.
  const untracked = await runGit(gitArgs(projectRoot, ["ls-files", "--others", "--exclude-standard"]), {
    cwd: projectRoot,
    env,
  });
  const untrackedRows = untracked.ok
    ? untracked.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((p) => `A\t${p}`)
    : [];

  const rows = r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .concat(untrackedRows);
  const truncated = rows.length > MAX_DIFF_FILES;
  const files: DiffFile[] = [];

  for (const row of rows.slice(0, MAX_DIFF_FILES)) {
    const [code, ...pathParts] = row.split("\t");
    const path = pathParts[pathParts.length - 1];
    if (!path) continue;
    // Codes relative to the save point: A = exists now but not then, D = existed then, gone now.
    const status: DiffFile["status"] = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified";

    let oldText = "";
    if (status !== "added") {
      const show = await runGit(gitArgs(projectRoot, ["show", `${hash}:${path}`]), { cwd: projectRoot, env });
      oldText = show.ok ? show.stdout : "";
    }
    let newText = "";
    let tooBig = false;
    let binary = false;
    if (status !== "deleted") {
      try {
        const buf = readFileSync(join(projectRoot, path));
        if (buf.length > MAX_DIFF_BYTES) tooBig = true;
        else if (isBinaryBuffer(buf)) binary = true;
        else newText = buf.toString("utf8");
      } catch {
        /* unreadable → empty */
      }
    }
    if (Buffer.byteLength(oldText) > MAX_DIFF_BYTES) {
      tooBig = true;
      oldText = "";
    }
    if (tooBig || binary) newText = "";
    files.push({ path, status, old: tooBig || binary ? "" : oldText, new: newText, ...(tooBig ? { tooBig } : {}), ...(binary ? { binary } : {}) });
  }
  return { ok: true, files, ...(truncated ? { truncated } : {}) };
}

/** Undoable restore: safety commit → reset --hard target → move the branch
 *  back to the tip → commit the restored state as a new save point. History is
 *  never lost, so a restore can itself be undone from the same list. */
export async function restoreSavePoint(
  cwd: string,
  hash: string,
  labels: { safety: string; restored: string }
): Promise<{ ok: boolean; error?: string }> {
  const projectRoot = projectRootFor(cwd);
  if (!projectRoot || !(await gitAvailable()) || !existsSync(shadowGitDir(projectRoot))) {
    return { ok: false, error: "no-history" };
  }
  return withProjectLock(projectRoot, async () => {
    const env = shadowEnv();
    if (await hasChanges(projectRoot)) {
      if (!(await commitAll(projectRoot, labels.safety))) return { ok: false, error: "safety-failed" };
    }
    const tip = await runGit(gitArgs(projectRoot, ["rev-parse", "HEAD"]), { cwd: projectRoot, env });
    if (!tip.ok) return { ok: false, error: "no-head" };

    const hard = await runGit(gitArgs(projectRoot, ["reset", "--hard", hash]), { cwd: projectRoot, env, timeoutMs: 60_000 });
    if (!hard.ok) return { ok: false, error: "reset-failed" };
    const back = await runGit(gitArgs(projectRoot, ["reset", "--soft", tip.stdout.trim()]), { cwd: projectRoot, env });
    if (!back.ok) return { ok: false, error: "reset-failed" };

    if (await hasChanges(projectRoot)) {
      await commitAll(projectRoot, labels.restored);
    }
    return { ok: true };
  });
}
