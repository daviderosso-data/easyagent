import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { AccountStatus } from "@/server/providers/types";

const execFileP = promisify(execFile);

// Make the `claude` CLI reachable and force subscription auth (no API key).
function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const extra = `${homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin`;
  env.PATH = `${extra}:${env.PATH ?? ""}`;
  return env;
}

export async function accountStatus(): Promise<AccountStatus> {
  try {
    const { stdout } = await execFileP("claude", ["auth", "status", "--json"], {
      env: claudeEnv(),
      timeout: 15000,
    });
    const j = JSON.parse(stdout);
    return {
      loggedIn: !!j.loggedIn,
      email: j.email,
      subscriptionType: j.subscriptionType,
      authMethod: j.authMethod,
    };
  } catch {
    return { loggedIn: false };
  }
}

export async function logout(): Promise<void> {
  try {
    await execFileP("claude", ["auth", "logout"], { env: claudeEnv(), timeout: 15000 });
  } catch {
    /* ignore — treated as logged out */
  }
}

/** Launches the browser OAuth login (subscription) detached. The browser opens;
 *  the caller polls accountStatus() to detect completion. */
export function startLogin(): void {
  const child = spawn("claude", ["auth", "login", "--claudeai"], {
    env: claudeEnv(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/** Poll until logged in (or timeout). Used after startLogin(). */
export async function waitForLogin(timeoutMs = 180000): Promise<AccountStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await accountStatus();
    if (s.loggedIn) return s;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { loggedIn: false };
}
