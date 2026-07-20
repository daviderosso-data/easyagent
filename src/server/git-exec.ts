import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { devNull } from "node:os";

const execFileP = promisify(execFile);

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run git with an args array (no shell). Never throws. */
export async function runGit(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileP("git", args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      timeout: opts.timeoutMs ?? 15_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, stdout, stderr };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "git failed" };
  }
}

const g = globalThis as unknown as { __ccw_git_ok?: Promise<boolean> };

/** Whether git is installed. Probed once per process (HMR-safe). */
export function gitAvailable(): Promise<boolean> {
  return (g.__ccw_git_ok ??= runGit(["--version"], { timeoutMs: 5000 }).then((r) => r.ok));
}

/** Deterministic env for shadow-repo operations: no user/system git config,
 *  fixed identity, no interactive prompts. */
export function shadowEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "easyagent",
    GIT_AUTHOR_EMAIL: "save@easyagent.local",
    GIT_COMMITTER_NAME: "easyagent",
    GIT_COMMITTER_EMAIL: "save@easyagent.local",
    GIT_TERMINAL_PROMPT: "0",
  };
}
