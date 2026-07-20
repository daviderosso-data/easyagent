export interface CommandInfo {
  name: string;
  description: string;
  argumentHint: string;
  aliases: string[];
}

export interface CommandsResult {
  ok: boolean;
  commands: CommandInfo[];
  error?: string;
}

// Cache the command list per folder — the mini-query that fetches it is cheap but
// not free, and the list rarely changes within a session.
const cache = new Map<string, CommandInfo[]>();

/** Drop the cached list (one folder or all) — e.g. after a skill is created,
 *  toggled, or deleted, so the palette refetches. */
export function clearCommandsCache(cwd?: string): void {
  if (cwd === undefined) cache.clear();
  else cache.delete(cwd);
}

export async function apiListCommands(
  cwd: string,
  token: string | null,
  force = false,
): Promise<CommandsResult> {
  if (!force && cache.has(cwd)) return { ok: true, commands: cache.get(cwd)! };
  try {
    const r = await fetch(`/api/commands?cwd=${encodeURIComponent(cwd)}`, {
      headers: token ? { "x-ccw-token": token } : {},
    });
    const d = await r.json();
    if (!r.ok || !Array.isArray(d.commands)) {
      return { ok: false, commands: [], error: d.error ?? "error" };
    }
    cache.set(cwd, d.commands);
    return { ok: true, commands: d.commands };
  } catch {
    return { ok: false, commands: [], error: "network" };
  }
}
