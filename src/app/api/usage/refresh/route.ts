import { query } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import { tokenValid, buildAgentEnv } from "@/server/security";
import { captureRateLimits } from "@/server/agent-runner";
import { readUsage } from "@/server/usage-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

// Runs Claude Code's /usage command and captures subscription rate limits
// (right after init, while the query is still live), then returns fresh usage.
export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized" }, { status: 403 });
  try {
    const q = query({
      prompt: "/usage",
      options: { cwd: homedir(), maxTurns: 1, env: buildAgentEnv() } as any,
    });
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === "system" && m.subtype === "init") {
        await captureRateLimits(q);
        break; // done — no need to run the rest of the command
      }
    }
    try {
      await (q as any).interrupt?.();
    } catch {
      /* ignore */
    }
  } catch {
    /* best effort */
  }
  return Response.json(readUsage());
}
