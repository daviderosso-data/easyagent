import { existsSync } from "node:fs";
import { join } from "node:path";
import { runGit, gitAvailable } from "@/server/git-exec";

// Minimal git operations on the project's OWN repository (the "Advanced (git)"
// section). Uses the user's normal git config so pushes go through their
// credential helpers; never prompts interactively.

function userEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

export interface GitViewFile {
  path: string;
  status: "modified" | "new" | "deleted" | "renamed";
}

export interface GitViewStatus {
  ok: boolean;
  gitMissing?: boolean;
  hasRepo: boolean;
  branch?: string;
  hasRemote?: boolean;
  files: GitViewFile[];
}

function mapStatus(xy: string): GitViewFile["status"] {
  if (xy.includes("R")) return "renamed";
  if (xy.includes("D")) return "deleted";
  if (xy.includes("?") || xy.includes("A")) return "new";
  return "modified";
}

export async function projectGitStatus(projectRoot: string): Promise<GitViewStatus> {
  if (!(await gitAvailable())) return { ok: true, gitMissing: true, hasRepo: false, files: [] };
  if (!existsSync(join(projectRoot, ".git"))) return { ok: true, hasRepo: false, files: [] };
  const env = userEnv();
  const opts = { cwd: projectRoot, env };

  const [branch, remotes, status] = await Promise.all([
    // branch --show-current works even before the first commit (unborn branch).
    runGit(["branch", "--show-current"], opts),
    runGit(["remote"], opts),
    runGit(["-c", "core.quotepath=false", "status", "--porcelain"], opts),
  ]);

  const files: GitViewFile[] = status.ok
    ? status.stdout
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const xy = l.slice(0, 2);
          const rest = l.slice(3);
          // Renames come as "old -> new"; show the new path.
          const path = rest.includes(" -> ") ? rest.split(" -> ")[1] : rest;
          return { path, status: mapStatus(xy) };
        })
    : [];

  return {
    ok: true,
    hasRepo: true,
    branch: branch.ok ? branch.stdout.trim() : undefined,
    hasRemote: remotes.ok && remotes.stdout.trim().length > 0,
    files,
  };
}

export async function projectGitCommit(projectRoot: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const env = userEnv();
  const opts = { cwd: projectRoot, env, timeoutMs: 60_000 };
  const add = await runGit(["add", "-A"], opts);
  if (!add.ok) return { ok: false, error: "add-failed" };
  let commit = await runGit(["commit", "-m", message], opts);
  if (!commit.ok && /tell me who you are|user\.name|user\.email/i.test(commit.stderr + commit.stdout)) {
    commit = await runGit(
      ["-c", "user.name=easyclaude", "-c", "user.email=save@easyclaude.local", "commit", "-m", message],
      opts
    );
  }
  return commit.ok ? { ok: true } : { ok: false, error: "commit-failed" };
}

export async function projectGitPush(projectRoot: string): Promise<{ ok: boolean; errorTail?: string }> {
  const r = await runGit(["push"], { cwd: projectRoot, env: userEnv(), timeoutMs: 60_000 });
  if (r.ok) return { ok: true };
  const tail = (r.stderr || r.stdout).trim().split("\n").slice(-6).join("\n");
  return { ok: false, errorTail: tail };
}

export async function projectGitInit(projectRoot: string): Promise<{ ok: boolean }> {
  const r = await runGit(["init", "-b", "main"], { cwd: projectRoot, env: userEnv() });
  return { ok: r.ok };
}
