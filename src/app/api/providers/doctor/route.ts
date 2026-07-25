import { tokenValid } from "@/server/security";
import { codexCmd, codexStatus } from "@/server/providers/codex/runner";
import { copilotCmd, copilotToken } from "@/server/providers/copilot/runner";
import { grokStatus, resolveGrokBin } from "@/server/providers/grok/runner";
import { OLLAMA_URL, ollamaModels, ollamaStatus } from "@/server/providers/ollama/runner";
import { runQuick } from "@/server/providers/cli-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export interface EngineDiag {
  id: string;
  label: string;
  installed: boolean;
  /** Resolved binary path; "npx" when running through the npx fallback. */
  path: string | null;
  version: string | null;
  /** null = engine has no login concept (Ollama). */
  loggedIn: boolean | null;
  /** What's broken, if anything, plus the command that fixes it. */
  fix: { kind: "install" | "login" | "start" | "auth"; command?: string } | null;
}

async function versionOf(cmd: string, pre: string[]): Promise<string | null> {
  const r = await runQuick(cmd, [...pre, "--version"], 20000);
  const line = `${r.stdout}\n${r.stderr}`.trim().split("\n")[0]?.trim();
  return r.ok && line ? line : null;
}

/** P6.9.5 — per-engine health: binary, version, login, daemon reachability. */
export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ engines: [] }, { status: 403 });

  const [codex, grok, copilot, ollama] = await Promise.all([
    (async (): Promise<EngineDiag> => {
      const inv = codexCmd();
      const st = await codexStatus();
      const usesNpx = !!inv && inv.pre.length > 0;
      return {
        id: "codex",
        label: "Codex (ChatGPT)",
        installed: st.installed,
        path: inv ? (usesNpx ? "npx" : inv.cmd) : null,
        version: inv ? await versionOf(inv.cmd, inv.pre) : null,
        loggedIn: st.installed ? !!st.loggedIn : null,
        fix: !st.installed
          ? { kind: "install", command: "npm install -g @openai/codex" }
          : st.loggedIn
            ? null
            : { kind: "login" },
      };
    })(),
    (async (): Promise<EngineDiag> => {
      const bin = resolveGrokBin();
      const st = await grokStatus();
      return {
        id: "grok",
        label: "Grok Build",
        installed: !!bin,
        path: bin,
        version: bin ? await versionOf(bin, []) : null,
        loggedIn: bin ? !!st.loggedIn : null,
        fix: !bin
          ? { kind: "install", command: "brew install --cask grok-build" }
          : st.loggedIn
            ? null
            : { kind: "login" },
      };
    })(),
    (async (): Promise<EngineDiag> => {
      const inv = copilotCmd();
      const usesNpx = !!inv && inv.pre.length > 0;
      const token = await copilotToken();
      return {
        id: "copilot",
        label: "Copilot (GitHub)",
        installed: !!inv,
        path: inv ? (usesNpx ? "npx" : inv.cmd) : null,
        version: inv ? await versionOf(inv.cmd, inv.pre) : null,
        loggedIn: token ? true : null,
        fix: !inv
          ? { kind: "install", command: "npm install -g @github/copilot" }
          : token
            ? null
            : { kind: "auth", command: "gh auth login" },
      };
    })(),
    (async (): Promise<EngineDiag> => {
      const st = await ollamaStatus();
      let version: string | null = null;
      if (st.installed) {
        try {
          const r = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(1500) });
          version = r.ok ? ((await r.json()).version ?? null) : null;
        } catch {
          /* daemon just probed ok; version is best-effort */
        }
      }
      const models = st.installed ? (await ollamaModels()).length : 0;
      return {
        id: "ollama",
        label: `Ollama (${OLLAMA_URL.replace(/^https?:\/\//, "")}${st.installed ? `, ${models} models` : ""})`,
        installed: st.installed,
        path: null,
        version,
        loggedIn: null,
        fix: st.installed ? null : { kind: "start", command: "ollama serve" },
      };
    })(),
  ]);

  return Response.json({ engines: [codex, grok, copilot, ollama] });
}
