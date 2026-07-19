// Client-safe usage types (no imports — shared by server stores and UI components).

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

export interface Aggregate {
  turns: number;
  costUsd: number;
  inTok: number;
  outTok: number;
  cacheTok: number;
}

/** One local-time day of activity in a time series (zero-filled when idle). */
export interface SeriesBucket {
  /** Local calendar day, "YYYY-MM-DD". */
  day: string;
  /** Epoch ms of that day's local midnight (chart x / label formatting). */
  ts: number;
  costUsd: number;
  inTok: number;
  outTok: number;
  cacheTok: number;
  turns: number;
  errors: number;
  aborted: number;
}

/** Per-project or per-model rollup. `key` is "" when the field is missing (v1 lines). */
export interface BreakdownRow {
  key: string;
  turns: number;
  costUsd: number;
  inTok: number;
  outTok: number;
  cacheTok: number;
  errors: number;
  aborted: number;
  /** Mean over events with a positive duration; null when none. */
  avgDurationMs: number | null;
}

export interface UsageSeries {
  days: number;
  from: number;
  to: number;
  /** Oldest → newest, always `days` entries, zero-filled. */
  buckets: SeriesBucket[];
  /** Sorted by costUsd desc. */
  byProject: BreakdownRow[];
  byModel: BreakdownRow[];
  status: { ok: number; error: number; aborted: number };
  totals: { turns: number; costUsd: number; inTok: number; outTok: number; cacheTok: number };
}
