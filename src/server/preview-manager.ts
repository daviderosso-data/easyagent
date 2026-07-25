import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { buildAgentEnv } from "@/server/security";
import { detectPreview } from "@/server/preview-detect";
import { startStaticServer } from "@/server/static-server";

export type PreviewState = "idle" | "installing" | "starting" | "running" | "error";

export interface PreviewInfo {
  state: PreviewState;
  url?: string;
  kind?: "static" | "node" | "none";
  error?: string;
  logTail?: string[];
}

interface PreviewEntry {
  state: PreviewState;
  kind: "static" | "node";
  url?: string;
  error?: string;
  log: string[];
  child?: ChildProcess;
  closeStatic?: () => void;
  stopping?: boolean;
}

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/;
const START_TIMEOUT_MS = 60_000;
const PROBE_START_MS = 10_000;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Scrubbed env for dev servers (no host secrets), with the same PATH prepend
 *  account.ts uses so npm resolves outside login shells. */
function previewEnv(port: number): NodeJS.ProcessEnv {
  const env = { ...buildAgentEnv() } as NodeJS.ProcessEnv;
  env.PATH = `${homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${env.PATH ?? ""}`;
  env.PORT = String(port);
  env.BROWSER = "none";
  env.FORCE_COLOR = "0";
  env.CI = "1";
  return env;
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    // Negative pid → whole process group (npm's grandchildren included).
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* gone */
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }, 3000).unref();
}

/* P6.11.6 — single-file previews share one static server per project (same
 * separate-origin security model as the normal preview). Lives for the
 * process; loopback-only and path-confined by the static server itself. */
const fileServers = new Map<string, { url: string; close: () => void }>();

export async function fileStaticBaseUrl(projectRoot: string): Promise<string | null> {
  let key: string;
  try {
    key = realpathSync(projectRoot);
  } catch {
    return null;
  }
  const existing = fileServers.get(key);
  if (existing) return existing.url;
  try {
    const srv = await startStaticServer(key);
    fileServers.set(key, { url: srv.url, close: srv.close });
    return srv.url;
  } catch {
    return null;
  }
}

class PreviewManager {
  private entries = new Map<string, PreviewEntry>();

  status(projectRoot: string): PreviewInfo {
    const key = this.key(projectRoot);
    const e = this.entries.get(key);
    if (!e) {
      const plan = detectPreview(projectRoot);
      return { state: "idle", kind: plan.kind === "none" ? "none" : plan.kind };
    }
    return { state: e.state, url: e.url, kind: e.kind, error: e.error, logTail: e.log.slice(-15) };
  }

  async start(projectRoot: string): Promise<PreviewInfo> {
    const key = this.key(projectRoot);
    const existing = this.entries.get(key);
    if (existing && existing.state !== "error") return this.status(projectRoot);

    const plan = detectPreview(projectRoot);
    if (plan.kind === "none") return { state: "idle", kind: "none" };

    if (plan.kind === "static") {
      const entry: PreviewEntry = { state: "starting", kind: "static", log: [] };
      this.entries.set(key, entry);
      try {
        const srv = await startStaticServer(projectRoot);
        entry.closeStatic = srv.close;
        entry.url = srv.url;
        entry.state = "running";
      } catch (e) {
        entry.state = "error";
        entry.error = (e as Error).message;
      }
      return this.status(projectRoot);
    }

    const entry: PreviewEntry = { state: plan.needsInstall ? "installing" : "starting", kind: "node", log: [] };
    this.entries.set(key, entry);
    void this.runNode(key, projectRoot, plan.script, plan.needsInstall, entry);
    return this.status(projectRoot);
  }

  private async runNode(
    key: string,
    projectRoot: string,
    script: "dev" | "start",
    needsInstall: boolean,
    entry: PreviewEntry
  ): Promise<void> {
    const port = await freePort().catch(() => 0);

    if (needsInstall) {
      const ok = await new Promise<boolean>((resolve) => {
        const child = spawn("npm", ["install"], {
          cwd: projectRoot,
          env: previewEnv(port),
          detached: true,
        });
        entry.child = child;
        child.stdout?.on("data", (d) => this.pushLog(entry, d));
        child.stderr?.on("data", (d) => this.pushLog(entry, d));
        child.on("error", () => resolve(false));
        child.on("exit", (code) => resolve(code === 0));
      });
      if (entry.stopping) return;
      if (!ok) {
        entry.state = "error";
        entry.error = "install-failed";
        return;
      }
    }

    entry.state = "starting";
    const child = spawn("npm", ["run", script], {
      cwd: projectRoot,
      env: previewEnv(port),
      detached: true,
    });
    entry.child = child;

    const onChunk = (d: Buffer) => {
      this.pushLog(entry, d);
      if (entry.state === "starting") {
        const m = URL_RE.exec(d.toString());
        if (m) {
          entry.url = `http://127.0.0.1:${m[1]}`;
          entry.state = "running";
        }
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (e) => {
      entry.state = "error";
      entry.error = e.message;
    });
    child.on("exit", (code) => {
      if (entry.stopping) {
        entry.state = "idle";
        this.entries.delete(key);
      } else if (entry.state !== "error") {
        entry.state = "error";
        entry.error = `exited (${code ?? "?"})`;
      }
    });

    // Fallback: some tools (Vite) ignore PORT and print their own URL — the
    // parser above catches that. If nothing printed, probe the assigned port.
    const startedAt = Date.now();
    const probe = async () => {
      while (!entry.stopping && entry.state === "starting") {
        if (Date.now() - startedAt > START_TIMEOUT_MS) {
          entry.state = "error";
          entry.error = "timeout";
          killTree(child);
          return;
        }
        if (Date.now() - startedAt > PROBE_START_MS && port) {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
            if (r.status < 500) {
              entry.url = `http://127.0.0.1:${port}`;
              entry.state = "running";
              return;
            }
          } catch {
            /* not up yet */
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void probe();
  }

  async stop(projectRoot: string): Promise<void> {
    const key = this.key(projectRoot);
    const e = this.entries.get(key);
    if (!e) return;
    e.stopping = true;
    if (e.closeStatic) {
      e.closeStatic();
      this.entries.delete(key);
      return;
    }
    if (e.child) killTree(e.child);
    else this.entries.delete(key);
  }

  stopAll(): void {
    for (const e of this.entries.values()) {
      e.stopping = true;
      try {
        e.closeStatic?.();
      } catch {
        /* best effort */
      }
      if (e.child) killTree(e.child);
    }
    this.entries.clear();
  }

  private key(projectRoot: string): string {
    try {
      return realpathSync(projectRoot);
    } catch {
      return projectRoot;
    }
  }

  private pushLog(entry: PreviewEntry, d: Buffer): void {
    for (const line of d.toString().split("\n")) {
      const t = line.trimEnd();
      if (t) entry.log.push(t);
    }
    if (entry.log.length > 50) entry.log.splice(0, entry.log.length - 50);
  }
}

const g = globalThis as unknown as { __ccw_previewManager?: PreviewManager; __ccw_previewExitHook?: boolean };
export const previewManager: PreviewManager = g.__ccw_previewManager ?? (g.__ccw_previewManager = new PreviewManager());

// Previews must not outlive the app.
if (!g.__ccw_previewExitHook) {
  g.__ccw_previewExitHook = true;
  const cleanup = () => previewManager.stopAll();
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}
