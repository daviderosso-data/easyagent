// Marketplace integrations: skill search/install via skills.sh (probe-verified
// 2026-07-21: GET https://skills.sh/api/search is public JSON, no CORS → must
// be proxied server-side; installs go through the official `skills` CLI which
// clones the source repo and copies the skill into <project>/.claude/skills/).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectRootFor } from "@/server/snapshots";
import { SKILL_NAME_RE } from "@/server/skills";
import { resolveBin, runQuick } from "@/server/providers/cli-utils";

export interface SkillHit {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

/** GitHub owner/repo — the only source shape we install from. */
const SOURCE_RE = /^[A-Za-z0-9_.-]{1,80}\/[A-Za-z0-9_.-]{1,100}$/;

/* ---------- MCP servers: official registry ----------
 * mcpmarket.com is bot-challenged with an auth-only product API (probe
 * 2026-07-21), so we search the official MCP Registry instead — anonymous
 * read API, the upstream source such marketplaces consume. It is SLOW
 * (25-37s TTFB observed) → 60s timeout + in-memory cache. */

interface KeySpec {
  name: string;
  required: boolean;
  secret: boolean;
}

export type McpMarketConfig =
  | { kind: "stdio"; command: string; args: string[]; envKeys: KeySpec[] }
  | { kind: "http" | "sse"; url: string; headerKeys: KeySpec[] };

export interface McpMarketHit {
  name: string;
  short: string;
  description: string;
  repository?: string;
  config: McpMarketConfig;
}

const MCP_CACHE_TTL = 60 * 60 * 1000;
const g = globalThis as unknown as { __ccw_mcpMarket?: Map<string, { ts: number; hits: McpMarketHit[] }> };
const mcpCache = (g.__ccw_mcpMarket ??= new Map());

function shortNameFor(full: string, taken: Set<string>): string {
  const sanitize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, 28);
  const last = full.split("/").pop() ?? "server";
  // Dropping a -mcp/-server suffix reads nicer, but never at the cost of the
  // whole name (e.g. "notion-mcp-server" → "notion", but "mcp-server" stays).
  const stripped = sanitize(last.replace(/(-|_)?mcp(-server)?$/i, "").replace(/(-|_)?server$/i, ""));
  let base = stripped.length >= 3 ? stripped : sanitize(last);
  if (!/^[a-z0-9]/.test(base)) base = sanitize(`s${base}`);
  if (!base) base = "server";
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  taken.add(name);
  return name;
}

function keySpecs(list: unknown): KeySpec[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => v as Record<string, unknown>)
    .filter((v) => typeof v.name === "string")
    .map((v) => ({ name: String(v.name), required: v.isRequired !== false, secret: v.isSecret === true }));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function argValues(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const a of list as any[]) {
    const value = typeof a?.value === "string" ? a.value : typeof a?.default === "string" ? a.default : undefined;
    if (a?.type === "named" && typeof a?.name === "string") {
      out.push(a.name);
      if (value !== undefined) out.push(value);
    } else if (value !== undefined) {
      out.push(value);
    }
  }
  return out;
}

function hitFromServer(server: any, taken: Set<string>): McpMarketHit | null {
  const name = typeof server?.name === "string" ? server.name : "";
  if (!name) return null;
  const description = typeof server?.description === "string" ? server.description.slice(0, 200) : "";
  const repository = typeof server?.repository?.url === "string" ? server.repository.url : undefined;
  const packages: any[] = Array.isArray(server?.packages) ? server.packages : [];
  const remotes: any[] = Array.isArray(server?.remotes) ? server.remotes : [];

  const npm = packages.find((p) => p?.registryType === "npm" && p?.transport?.type === "stdio");
  const pypi = packages.find((p) => p?.registryType === "pypi" && p?.transport?.type === "stdio");
  let config: McpMarketConfig | null = null;
  if (npm && typeof npm.identifier === "string") {
    config = {
      kind: "stdio",
      command: "npx",
      args: ["-y", `${npm.identifier}@latest`, ...argValues(npm.runtimeArguments), ...argValues(npm.packageArguments)],
      envKeys: keySpecs(npm.environmentVariables),
    };
  } else if (pypi && typeof pypi.identifier === "string") {
    config = {
      kind: "stdio",
      command: "uvx",
      args: [String(pypi.identifier), ...argValues(pypi.packageArguments)],
      envKeys: keySpecs(pypi.environmentVariables),
    };
  } else {
    const remote = remotes.find((r) => r?.type === "streamable-http" || r?.type === "sse");
    if (remote && typeof remote.url === "string") {
      config = {
        kind: remote.type === "sse" ? "sse" : "http",
        url: remote.url,
        headerKeys: keySpecs(remote.headers),
      };
    }
  }
  if (!config) return null;
  return { name, short: shortNameFor(name, taken), description, repository, config };
}

export async function searchMcpMarket(q: string): Promise<{ ok: boolean; servers?: McpMarketHit[]; error?: string }> {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return { ok: true, servers: [] };
  const cached = mcpCache.get(query);
  if (cached && Date.now() - cached.ts < MCP_CACHE_TTL) return { ok: true, servers: cached.hits };
  try {
    const r = await fetch(
      `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(query)}&version=latest&limit=30`,
      { signal: AbortSignal.timeout(60000), headers: { accept: "application/json" } },
    );
    if (!r.ok) return { ok: false, error: `registry ${r.status}` };
    const d = (await r.json()) as { servers?: any[] };
    const taken = new Set<string>();
    const hits: McpMarketHit[] = [];
    for (const item of d.servers ?? []) {
      const meta = item?._meta?.["io.modelcontextprotocol.registry/official"];
      if (meta && (meta.status !== "active" || meta.isLatest === false)) continue;
      const hit = hitFromServer(item?.server, taken);
      if (hit) hits.push(hit);
    }
    mcpCache.set(query, { ts: Date.now(), hits });
    return { ok: true, servers: hits };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function searchSkillsMarket(q: string): Promise<{ ok: boolean; skills?: SkillHit[]; error?: string }> {
  const query = q.trim();
  if (query.length < 2) return { ok: true, skills: [] };
  try {
    const r = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=20`, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: "application/json" },
    });
    if (!r.ok) return { ok: false, error: `search ${r.status}` };
    const d = (await r.json()) as { skills?: unknown[] };
    const skills: SkillHit[] = (Array.isArray(d.skills) ? d.skills : [])
      .map((s) => s as Record<string, unknown>)
      .filter((s) => typeof s.skillId === "string" && typeof s.source === "string" && SOURCE_RE.test(s.source as string))
      .map((s) => ({
        id: String(s.id ?? `${s.source}/${s.skillId}`),
        skillId: String(s.skillId),
        name: String(s.name ?? s.skillId),
        installs: typeof s.installs === "number" ? s.installs : 0,
        source: String(s.source),
      }));
    return { ok: true, skills };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

/** Install one skill into the project via the official CLI (non-interactive,
 *  copies real files). Success = SKILL.md exists afterwards. */
export async function installSkillFromMarket(
  cwd: string,
  source: string,
  skillId: string,
): Promise<{ ok: boolean; error?: string }> {
  const projectRoot = projectRootFor(cwd);
  if (!projectRoot) return { ok: false, error: "bad-project" };
  if (!SOURCE_RE.test(source) || !SKILL_NAME_RE.test(skillId)) return { ok: false, error: "bad-request" };
  const npx = resolveBin(["npx"]);
  if (!npx) return { ok: false, error: "npx-missing" };

  const r = await runQuick(
    npx,
    ["--yes", "skills@latest", "add", source, "--skill", skillId, "--agent", "claude-code", "-y", "--copy"],
    180000,
    { cwd: projectRoot, env: { DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" } },
  );
  const installed = existsSync(join(projectRoot, ".claude", "skills", skillId, "SKILL.md"));
  if (installed) return { ok: true };
  const tail = `${r.stderr}\n${r.stdout}`.trim().slice(-300);
  console.error("[marketplace] skill install failed:", skillId, tail);
  return { ok: false, error: "install-failed" };
}
