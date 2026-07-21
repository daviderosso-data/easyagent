// Shared plumbing for engines driven through a spawned CLI (Codex, Grok):
// binary resolution, scrubbed env, line-oriented stdout streaming, and
// process-group kill on abort.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { buildAgentEnv } from "@/server/security";

const execFileP = promisify(execFile);

function extendedPath(): string {
  const extra = [`${homedir()}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin"];
  return [...extra, process.env.PATH ?? ""].join(delimiter);
}

/** Scrubbed env for engine subprocesses: same allow-list as the Claude agent
 *  (no ambient API keys/tokens ever reach the engine — subscription auth by
 *  construction), plus a PATH that reaches user-installed CLIs. */
export function engineEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  // Next's types make NODE_ENV mandatory on ProcessEnv; the scrubbed env
  // deliberately omits it, hence the cast.
  const env = buildAgentEnv() as NodeJS.ProcessEnv;
  env.PATH = extendedPath();
  return { ...env, ...extra };
}

/** Find the first usable binary: an absolute path that exists, or a bare name
 *  present in the (extended) PATH. */
export function resolveBin(candidates: string[]): string | null {
  const dirs = extendedPath().split(delimiter).filter(Boolean);
  for (const c of candidates) {
    if (c.includes("/")) {
      if (existsSync(c)) return c;
      continue;
    }
    for (const d of dirs) {
      const p = join(d, c);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Short, non-throwing command run for status probes and installers. */
export async function runQuick(
  cmd: string,
  args: string[],
  timeoutMs = 15000,
  opts?: { cwd?: string; env?: Record<string, string> },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      env: { ...engineEnv(), ...opts?.env },
      timeout: timeoutMs,
      ...(opts?.cwd ? { cwd: opts.cwd } : {}),
    });
    return { ok: true, stdout, stderr };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

export interface StreamRunParams {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  /** Called once per complete stdout line (trailing newline stripped). */
  onLine: (line: string) => void;
}

/** Spawn a CLI and stream its stdout line by line. Resolves when the process
 *  exits; on signal abort the whole process group is killed (engines spawn
 *  their own children). Never rejects. */
export function streamLines(params: StreamRunParams): Promise<{ code: number | null; aborted: boolean }> {
  const { cmd, args, cwd, env, signal, onLine } = params;
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] as const, detached: true });

    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      }
    };
    if (signal.aborted) kill();
    signal.addEventListener("abort", kill, { once: true });

    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.trim()) onLine(line);
      }
    });
    let stderrTail = "";
    child.stderr.on("data", (d: Buffer) => {
      stderrTail = (stderrTail + d.toString("utf8")).slice(-2000);
    });

    child.on("error", () => {
      signal.removeEventListener("abort", kill);
      resolvePromise({ code: null, aborted: signal.aborted });
    });
    child.on("close", (code) => {
      if (buf.trim()) onLine(buf.trim());
      signal.removeEventListener("abort", kill);
      if (code !== 0 && !signal.aborted && stderrTail.trim()) {
        console.error(`[${cmd}] exited ${code}: ${stderrTail.trim().slice(-500)}`);
      }
      resolvePromise({ code, aborted: signal.aborted });
    });
  });
}
