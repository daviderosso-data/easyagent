import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { homedir } from "node:os";
import { listMcpServers, buildMcpConfig, recordMcpStatus } from "@/server/mcp-store";
import { tokenValid, buildAgentEnv } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 30;

const Body = z.object({ id: z.string().max(64) });

/** Probe a single connection with a throwaway query (same idiom as
 *  /api/commands): wait for init, poll mcpServerStatus until it settles,
 *  interrupt. No turn runs, no tokens spent. */
export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const entry = listMcpServers().find((e) => e.id === body.id);
  if (!entry) return Response.json({ ok: false, error: "not-found" }, { status: 404 });

  const base = buildMcpConfig([{ ...entry, enabled: true }]);
  // alwaysLoad makes the SDK wait (up to ~5s) for the connection before init,
  // so the init message usually carries a settled status already.
  const single = { [entry.name]: { ...base[entry.name], alwaysLoad: true } };
  let result: { status: string; error?: string; tools?: { name: string }[] } = { status: "pending" };

  interface ServerStatus {
    name: string;
    status: string;
    error?: unknown;
    tools?: { name: string }[];
  }
  interface ProbeQuery {
    mcpServerStatus?: () => Promise<ServerStatus[]>;
    interrupt?: () => Promise<void>;
  }
  interface ProbeMsg {
    type: string;
    subtype?: string;
    mcp_servers?: { name: string; status: string }[];
  }

  try {
    const q = query({
      prompt: "/help",
      options: {
        cwd: homedir(),
        maxTurns: 1,
        settingSources: [],
        mcpServers: single,
        strictMcpConfig: true,
        env: buildAgentEnv(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    const probe = q as unknown as ProbeQuery;
    for await (const m of q as AsyncIterable<ProbeMsg>) {
      if (m.type === "system" && m.subtype === "init") {
        const fromInit = (m.mcp_servers ?? []).find((s) => s.name === entry.name);
        if (fromInit) result = { status: fromInit.status };
        // A few guarded polls for tools/errors; the short-lived /help process
        // may exit mid-poll, so a transport error must not clobber a real status.
        for (let i = 0; i < 16 && result.status === "pending"; i++) {
          try {
            const st = (await probe.mcpServerStatus?.()) ?? [];
            const mine = st.find((s) => s.name === entry.name);
            if (mine) {
              result = {
                status: mine.status,
                ...(mine.error ? { error: String(mine.error).slice(0, 400) } : {}),
                ...(Array.isArray(mine.tools) ? { tools: mine.tools.map((t) => ({ name: t.name })) } : {}),
              };
            }
          } catch {
            break;
          }
          if (result.status === "pending") await new Promise((r) => setTimeout(r, 500));
        }
        if (result.status === "connected" && !result.tools) {
          try {
            const st = (await probe.mcpServerStatus?.()) ?? [];
            const mine = st.find((s) => s.name === entry.name);
            if (mine?.tools) result.tools = mine.tools.map((t) => ({ name: t.name }));
          } catch {
            /* keep status without tool list */
          }
        }
        try {
          await probe.interrupt?.();
        } catch {
          /* transport may already be closing */
        }
        break;
      }
    }
  } catch (e) {
    result = { status: "failed", error: (e as Error).message?.slice(0, 400) };
  }

  recordMcpStatus([{ name: entry.name, status: result.status, error: result.error }]);
  return Response.json({ ok: result.status === "connected", ...result, toolCount: result.tools?.length });
}
