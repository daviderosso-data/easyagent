import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".easyclaude");
const USAGE_FILE = join(DIR, "usage.jsonl");
const RATE_FILE = join(DIR, "ratelimits.json");

// Process start marks the "current session" window for self-tracked totals.
const g = globalThis as unknown as { __ccw_start?: number };
const START_TS: number = (g.__ccw_start ??= Date.now());

export type UsageStatus = "ok" | "error" | "aborted";

/** One recorded turn. Fields after `model` were added in schema v2 and are
 *  optional so old (v1) lines still parse; readers default them. */
export interface UsageEvent {
  v?: number;
  ts: number;
  costUsd: number;
  inTok: number;
  outTok: number;
  cacheTok: number;
  model: string;
  provider?: string;
  /** Project folder name (basename of the turn's cwd) for per-project breakdowns. */
  project?: string;
  sessionId?: string;
  effort?: string;
  durationMs?: number;
  numTurns?: number;
  status?: UsageStatus;
  subtype?: string;
}

export interface RateLimitWindow {
  utilization: number | null;
  resetsAt: string | null;
}
export interface RateLimits {
  subscriptionType: string | null;
  fiveHour: RateLimitWindow | null;
  sevenDay: RateLimitWindow | null;
  capturedAt: number;
}

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

export interface Aggregate {
  turns: number;
  costUsd: number;
  inTok: number;
  outTok: number;
  cacheTok: number;
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
