import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SETTINGS_DIR } from "@/server/settings-store";
import { PROJECTS_ROOT } from "@/server/projects";

// Global MCP "connections" registry. Lives in its own file (NOT AppSettings):
// entries may hold tokens, which must never round-trip through the settings
// PUT on every theme change, never reach the agent env, and never be logged.
const MCP_FILE = join(SETTINGS_DIR, "mcp.json");

export const MCP_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface McpEntry {
  id: string;
  /** Becomes the mcp__<name>__<tool> prefix — restricted charset, unique. */
  name: string;
  kind: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  presetId?: string;
}

const MAX_ARGS = 24;
const MAX_STR = 500;
const MAX_KV = 16;
const MAX_VAL = 4096;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/* ---------- file I/O ---------- */

function readAll(): McpEntry[] {
  try {
    if (!existsSync(MCP_FILE)) return [];
    const data = JSON.parse(readFileSync(MCP_FILE, "utf8"));
    return Array.isArray(data?.servers) ? (data.servers as McpEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(servers: McpEntry[]): void {
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(MCP_FILE, JSON.stringify({ v: 1, servers }, null, 2), { mode: 0o600 });
  try {
    chmodSync(MCP_FILE, 0o600); // `mode` only applies at creation
  } catch {
    /* best effort */
  }
}

export function listMcpServers(): McpEntry[] {
  return readAll();
}

/* ---------- validation (pure, testable) ---------- */

function cleanKv(obj: unknown, keyRe: RegExp | null): Record<string, string> | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v !== "string") return undefined;
    if (k.length > 200 || v.length > MAX_VAL) return undefined;
    if (keyRe && !keyRe.test(k)) return undefined;
    out[k] = v;
  }
  if (Object.keys(out).length > MAX_KV) return undefined;
  return out;
}

export function validateEntry(
  input: unknown,
  existing: McpEntry[],
  selfId?: string
): { ok: boolean; entry?: McpEntry; error?: string } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const name = String(raw.name ?? "").trim();
  if (!MCP_NAME_RE.test(name)) return { ok: false, error: "bad-name" };
  if (existing.some((e) => e.id !== selfId && e.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: "duplicate" };
  }
  const kind = raw.kind;
  if (kind !== "stdio" && kind !== "http" && kind !== "sse") return { ok: false, error: "bad-fields" };

  const entry: McpEntry = { id: selfId ?? randomUUID(), name, kind, enabled: raw.enabled !== false };
  if (typeof raw.presetId === "string") entry.presetId = raw.presetId;

  if (kind === "stdio") {
    const command = String(raw.command ?? "").trim();
    if (!command || command.length > MAX_STR) return { ok: false, error: "bad-fields" };
    entry.command = command;
    if (raw.args !== undefined) {
      if (!Array.isArray(raw.args) || raw.args.length > MAX_ARGS) return { ok: false, error: "bad-fields" };
      if (!raw.args.every((a) => typeof a === "string" && a.length <= MAX_STR)) return { ok: false, error: "bad-fields" };
      entry.args = raw.args as string[];
    }
    const env = cleanKv(raw.env ?? {}, ENV_KEY_RE);
    if (env === undefined) return { ok: false, error: "bad-fields" };
    if (Object.keys(env).length) entry.env = env;
  } else {
    const url = String(raw.url ?? "").trim();
    if (!/^https?:\/\//.test(url) || url.length > 2048) return { ok: false, error: "bad-fields" };
    entry.url = url;
    const headers = cleanKv(raw.headers ?? {}, null);
    if (headers === undefined) return { ok: false, error: "bad-fields" };
    if (Object.keys(headers).length) entry.headers = headers;
  }
  return { ok: true, entry };
}

/* ---------- CRUD ---------- */

export function addMcpServer(input: unknown): { ok: boolean; entry?: McpEntry; error?: string } {
  const servers = readAll();
  const res = validateEntry(input, servers);
  if (!res.ok || !res.entry) return res;
  servers.push(res.entry);
  writeAll(servers);
  return res;
}

export function updateMcpServer(id: string, patch: unknown): { ok: boolean; entry?: McpEntry; error?: string } {
  const servers = readAll();
  const idx = servers.findIndex((e) => e.id === id);
  if (idx < 0) return { ok: false, error: "not-found" };
  const merged = { ...servers[idx], ...(patch as object) };
  const res = validateEntry(merged, servers, id);
  if (!res.ok || !res.entry) return res;
  servers[idx] = res.entry;
  writeAll(servers);
  return res;
}

export function deleteMcpServer(id: string): boolean {
  const servers = readAll();
  const next = servers.filter((e) => e.id !== id);
  if (next.length === servers.length) return false;
  writeAll(next);
  return true;
}

/* ---------- SDK config ---------- */

export type SdkServerConfig =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> }
  | { type: "sse"; url: string; headers?: Record<string, string> };

/** SDK mcpServers Record from the enabled entries only. */
export function buildMcpConfig(entries?: McpEntry[]): Record<string, SdkServerConfig> {
  const out: Record<string, SdkServerConfig> = {};
  for (const e of entries ?? readAll()) {
    if (!e.enabled) continue;
    if (e.kind === "stdio" && e.command) {
      out[e.name] = { type: "stdio", command: e.command, ...(e.args?.length ? { args: e.args } : {}), ...(e.env ? { env: e.env } : {}) };
    } else if ((e.kind === "http" || e.kind === "sse") && e.url) {
      out[e.name] = { type: e.kind, url: e.url, ...(e.headers ? { headers: e.headers } : {}) };
    }
  }
  return out;
}

/* ---------- last-known status (HMR-safe) ---------- */

interface StatusInfo {
  status: string;
  error?: string;
  ts: number;
}
const g = globalThis as unknown as { __ccw_mcpStatus?: Map<string, StatusInfo> };
const statusMap = (g.__ccw_mcpStatus ??= new Map());

export function recordMcpStatus(list: { name: string; status: string; error?: string }[]): void {
  const now = Date.now();
  for (const s of list) {
    if (s?.name) statusMap.set(s.name, { status: s.status, ...(s.error ? { error: s.error } : {}), ts: now });
  }
}

export function getMcpStatus(): Record<string, StatusInfo> {
  return Object.fromEntries(statusMap);
}

/* ---------- presets ---------- */

export interface McpPreset {
  id: string;
  name: string;
  kind: McpEntry["kind"];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  requiresToken?: boolean;
  tokenHeader?: string;
  tokenPrefix?: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "github",
    name: "github",
    kind: "http",
    url: "https://api.githubcopilot.com/mcp/",
    requiresToken: true,
    tokenHeader: "Authorization",
    tokenPrefix: "Bearer ",
  },
  {
    id: "filesystem",
    name: "files",
    kind: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", PROJECTS_ROOT],
  },
  {
    id: "memory",
    name: "memory",
    kind: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: { MEMORY_FILE_PATH: join(homedir(), ".easyagent", "memory.json") },
  },
];

export function entryFromPreset(presetId: string, token?: string): McpEntry | null {
  const p = MCP_PRESETS.find((x) => x.id === presetId);
  if (!p) return null;
  if (p.requiresToken && !token?.trim()) return null;
  const entry: McpEntry = { id: randomUUID(), name: p.name, kind: p.kind, enabled: true, presetId: p.id };
  if (p.kind === "stdio") {
    entry.command = p.command;
    if (p.args) entry.args = [...p.args];
    if (p.env) entry.env = { ...p.env };
  } else {
    entry.url = p.url;
    if (p.requiresToken && p.tokenHeader) {
      entry.headers = { [p.tokenHeader]: `${p.tokenPrefix ?? ""}${token!.trim()}` };
    }
  }
  return entry;
}
