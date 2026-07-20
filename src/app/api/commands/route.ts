import { query } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import { tokenValid, buildAgentEnv, validateCwd } from "@/server/security";
import { skillsQueryOptions } from "@/server/skills";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CommandInfo {
  name: string;
  description: string;
  argumentHint: string;
  aliases: string[];
}

// Interactive / already-handled commands that aren't useful as one-click actions
// here (browser login/logout live in Settings → Account).
const HIDDEN_COMMANDS = new Set(["login", "logout"]);

// Not a genuinely usable command: internal (double-underscore) plumbing, or a
// command Claude Code flags as removed/deprecated in its description.
function isUsable(c: { name: string; description?: unknown }): boolean {
  if (c.name.startsWith("__")) return false;
  const desc = typeof c.description === "string" ? c.description.trim().toLowerCase() : "";
  if (desc.startsWith("(removed)") || desc.startsWith("(deprecated)")) return false;
  return true;
}

// Lists the slash commands available to Claude Code in a given folder (built-in
// dispatchable commands, skills and the project's custom commands), each with a
// description and argument hint. It starts a query only to read the command list
// captured at init, then interrupts it — no turn is actually run.
//
// Note: supportedCommands() is captured at init and does not reflect skills
// discovered mid-session; a fresh call reflects the folder's commands at startup.
export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized" }, { status: 403 });

  const url = new URL(req.url);
  const check = validateCwd(url.searchParams.get("cwd"));
  const dir = check.ok ? check.path : homedir();

  let commands: CommandInfo[] = [];
  try {
    const q = query({
      prompt: "/help",
      // Mirror the real turn's isolation and skills loading so the palette
      // lists exactly what a turn can use (no ambient MCP/config).
      options: {
        cwd: dir,
        maxTurns: 1,
        env: buildAgentEnv(),
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        ...(check.ok ? skillsQueryOptions(check.path!) : {}),
      } as any,
    });
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === "system" && m.subtype === "init") {
        const raw = (await (q as any).supportedCommands?.()) ?? [];
        commands = raw
          .filter((c: any) => c && typeof c.name === "string" && !HIDDEN_COMMANDS.has(c.name) && isUsable(c))
          .map((c: any) => ({
            name: c.name,
            description: typeof c.description === "string" ? c.description : "",
            argumentHint: typeof c.argumentHint === "string" ? c.argumentHint : "",
            aliases: Array.isArray(c.aliases) ? c.aliases.filter((a: unknown) => typeof a === "string") : [],
          }))
          .sort((a: CommandInfo, b: CommandInfo) => a.name.localeCompare(b.name));
        break; // command list captured — no need to run the rest
      }
    }
    try {
      await (q as any).interrupt?.();
    } catch {
      /* ignore */
    }
  } catch {
    return Response.json({ error: "Couldn't load commands." }, { status: 500 });
  }

  return Response.json({ commands });
}
