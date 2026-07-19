import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UsageEvent, RateLimits, Aggregate } from "@/lib/usage-types";

export type { UsageStatus, UsageEvent, RateLimitWindow, RateLimits, Aggregate } from "@/lib/usage-types";

const DIR = join(homedir(), ".easyclaude");
export const USAGE_FILE = join(DIR, "usage.jsonl");
const RATE_FILE = join(DIR, "ratelimits.json");

// Process start marks the "current session" window for self-tracked totals.
const g = globalThis as unknown as { __ccw_start?: number };
const START_TS: number = (g.__ccw_start ??= Date.now());

function ensureDir() {
  mkdirSync(DIR, { recursive: true });
}

export function recordUsage(e: UsageEvent): void {
  try {
    ensureDir();
    appendFileSync(USAGE_FILE, JSON.stringify(e) + "\n", "utf8");
  } catch {
    /* best effort */
  }
}

export function saveRateLimits(rl: RateLimits): void {
  try {
    ensureDir();
    writeFileSync(RATE_FILE, JSON.stringify(rl), "utf8");
  } catch {
    /* best effort */
  }
}

function empty(): Aggregate {
  return { turns: 0, costUsd: 0, inTok: 0, outTok: 0, cacheTok: 0 };
}
function add(a: Aggregate, e: UsageEvent) {
  a.turns += 1;
  a.costUsd += e.costUsd || 0;
  a.inTok += e.inTok || 0;
  a.outTok += e.outTok || 0;
  a.cacheTok += e.cacheTok || 0;
}

export function readUsage(): {
  session: Aggregate;
  week: Aggregate;
  total: Aggregate;
  rateLimits: RateLimits | null;
} {
  const session = empty();
  const week = empty();
  const total = empty();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  if (existsSync(USAGE_FILE)) {
    try {
      const lines = readFileSync(USAGE_FILE, "utf8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        let e: UsageEvent;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        add(total, e);
        if (e.ts >= weekAgo) add(week, e);
        if (e.ts >= START_TS) add(session, e);
      }
    } catch {
      /* ignore */
    }
  }

  let rateLimits: RateLimits | null = null;
  if (existsSync(RATE_FILE)) {
    try {
      rateLimits = JSON.parse(readFileSync(RATE_FILE, "utf8"));
    } catch {
      /* ignore */
    }
  }

  return { session, week, total, rateLimits };
}
