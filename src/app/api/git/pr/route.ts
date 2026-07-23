// P6.9.8 — open a GitHub PR for the project: branch off the default branch if
// needed, push, `gh pr create`. Requires the user's own gh CLI login; the
// title/body arrive from the UI (prefilled from the transcript, editable).

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import { promisify } from "node:util";
import { runGit } from "@/server/git-exec";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 120;

const execFileP = promisify(execFile);

/** The server may run from the double-click launcher, whose PATH misses
 *  Homebrew — extend it the same way the engine CLIs do. */
function ghEnv(): NodeJS.ProcessEnv {
  const extra = [`${homedir()}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin"];
  return { ...process.env, PATH: [...extra, process.env.PATH ?? ""].join(delimiter) };
}

async function runGh(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP("gh", args, { cwd, env: ghEnv(), timeout: 90_000, maxBuffer: 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "gh failed" };
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "changes"
  );
}

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 403 });
  let body: { cwd?: unknown; title?: unknown; description?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  }
  const check = validateCwd(body.cwd);
  if (!check.ok || !check.path) return Response.json({ ok: false, error: "bad-folder" }, { status: 400 });
  const cwd = check.path;
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const description = typeof body.description === "string" ? body.description.slice(0, 5000) : "";
  if (!title) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });

  const gh = await runGh(["--version"], cwd);
  if (!gh.ok) return Response.json({ ok: false, error: "no-gh" });

  const dirty = await runGit(["status", "--porcelain"], { cwd });
  if (!dirty.ok) return Response.json({ ok: false, error: "no-repo" });
  if (dirty.stdout.trim()) return Response.json({ ok: false, error: "dirty" });

  const cur = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd })).stdout.trim();
  const originHead = await runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd });
  const defaultBranch = originHead.ok ? originHead.stdout.trim().replace(/^origin\//, "") : "main";

  let branch = cur;
  if (!cur || cur === defaultBranch || cur === "HEAD") {
    branch = `easyagent/${slug(title)}-${Date.now().toString(36).slice(-4)}`;
    const co = await runGit(["checkout", "-b", branch], { cwd });
    if (!co.ok) return Response.json({ ok: false, error: "branch-failed", tail: co.stderr.slice(-400) });
  }

  const push = await runGit(["push", "-u", "origin", branch], { cwd, timeoutMs: 90_000 });
  if (!push.ok) return Response.json({ ok: false, error: "push-failed", tail: push.stderr.slice(-400) });

  const pr = await runGh(["pr", "create", "--title", title, "--body", description, "--head", branch], cwd);
  if (!pr.ok) return Response.json({ ok: false, error: "pr-failed", tail: (pr.stderr || pr.stdout).slice(-400) });

  const url = pr.stdout.trim().split("\n").pop() ?? "";
  return Response.json({ ok: true, url, branch });
}
