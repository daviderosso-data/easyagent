import { readFileSync, existsSync } from "node:fs";
import { USAGE_FILE } from "@/server/usage-store";
import type { UsageEvent, UsageSeries, SeriesBucket, BreakdownRow } from "@/lib/usage-types";

export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse JSONL usage lines, skipping blanks, malformed JSON and non-numeric ts.
 *  v1 lines (no project/model v2 fields) pass through as-is. */
export function parseUsageLines(text: string): UsageEvent[] {
  const out: UsageEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: UsageEvent;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e !== "object" || e === null || !Number.isFinite(e.ts)) continue;
    out.push(e);
  }
  return out;
}

/** Local calendar day "YYYY-MM-DD". Local time on purpose: single-machine app. */
function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function localMidnight(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

interface RowAcc extends BreakdownRow {
  durSum: number;
  durCount: number;
}

function newRow(key: string): RowAcc {
  return {
    key,
    turns: 0,
    costUsd: 0,
    inTok: 0,
    outTok: 0,
    cacheTok: 0,
    errors: 0,
    aborted: 0,
    avgDurationMs: null,
    durSum: 0,
    durCount: 0,
  };
}

function finishRows(map: Map<string, RowAcc>): BreakdownRow[] {
  return [...map.values()]
    .map(({ durSum, durCount, ...row }) => ({
      ...row,
      avgDurationMs: durCount > 0 ? durSum / durCount : null,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

/** Aggregate events into daily buckets + breakdowns, all scoped to the last
 *  `days` local calendar days ending today. Pure: no fs, injectable clock. */
export function aggregateSeries(events: UsageEvent[], days: RangeDays, now = Date.now()): UsageSeries {
  const from = localMidnight(now) - (days - 1) * DAY_MS;
  const buckets: SeriesBucket[] = [];
  const byIndex = new Map<string, SeriesBucket>();
  for (let i = 0; i < days; i++) {
    // Re-derive midnight per day so a DST shift inside the range can't skew keys.
    const ts = localMidnight(from + i * DAY_MS + DAY_MS / 2);
    const b: SeriesBucket = {
      day: dayKey(ts),
      ts,
      costUsd: 0,
      inTok: 0,
      outTok: 0,
      cacheTok: 0,
      turns: 0,
      errors: 0,
      aborted: 0,
    };
    buckets.push(b);
    byIndex.set(b.day, b);
  }

  const byProject = new Map<string, RowAcc>();
  const byModel = new Map<string, RowAcc>();
  const status = { ok: 0, error: 0, aborted: 0 };
  const totals = { turns: 0, costUsd: 0, inTok: 0, outTok: 0, cacheTok: 0 };

  for (const e of events) {
    if (e.ts < from || e.ts > now) continue;
    const bucket = byIndex.get(dayKey(e.ts));
    if (!bucket) continue;

    // v1 lines only logged successful result turns.
    const st = e.status ?? "ok";
    const cost = e.costUsd || 0;
    const inTok = e.inTok || 0;
    const outTok = e.outTok || 0;
    const cacheTok = e.cacheTok || 0;

    bucket.turns += 1;
    bucket.costUsd += cost;
    bucket.inTok += inTok;
    bucket.outTok += outTok;
    bucket.cacheTok += cacheTok;
    if (st === "error") bucket.errors += 1;
    if (st === "aborted") bucket.aborted += 1;

    status[st] += 1;
    totals.turns += 1;
    totals.costUsd += cost;
    totals.inTok += inTok;
    totals.outTok += outTok;
    totals.cacheTok += cacheTok;

    for (const [map, key] of [
      [byProject, (e.project ?? "").trim()],
      [byModel, (e.model ?? "").trim()],
    ] as const) {
      let row = map.get(key);
      if (!row) map.set(key, (row = newRow(key)));
      row.turns += 1;
      row.costUsd += cost;
      row.inTok += inTok;
      row.outTok += outTok;
      row.cacheTok += cacheTok;
      if (st === "error") row.errors += 1;
      if (st === "aborted") row.aborted += 1;
      if (typeof e.durationMs === "number" && e.durationMs > 0) {
        row.durSum += e.durationMs;
        row.durCount += 1;
      }
    }
  }

  return {
    days,
    from,
    to: now,
    buckets,
    byProject: finishRows(byProject),
    byModel: finishRows(byModel),
    status,
    totals,
  };
}

export function readUsageEvents(): UsageEvent[] {
  if (!existsSync(USAGE_FILE)) return [];
  try {
    return parseUsageLines(readFileSync(USAGE_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function readUsageSeries(days: RangeDays): UsageSeries {
  return aggregateSeries(readUsageEvents(), days);
}

const CSV_COLUMNS = [
  "ts",
  "date",
  "project",
  "model",
  "provider",
  "sessionId",
  "effort",
  "status",
  "subtype",
  "costUsd",
  "inTok",
  "outTok",
  "cacheTok",
  "durationMs",
  "numTurns",
] as const;

function csvField(v: unknown): string {
  if (v === undefined || v === null) return "";
  let s = String(v);
  // Spreadsheet formula-injection guard on string fields.
  if (typeof v === "string" && /^[=+\-@\t]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replaceAll('"', '""') + '"';
  return s;
}

/** Local "YYYY-MM-DD HH:mm:ss" for the human-readable date column. */
function localDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dayKey(ts)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function eventsToCsv(events: UsageEvent[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const e of events) {
    rows.push(
      CSV_COLUMNS.map((c) => (c === "date" ? csvField(localDateTime(e.ts)) : csvField(e[c]))).join(",")
    );
  }
  return rows.join("\n") + "\n";
}
