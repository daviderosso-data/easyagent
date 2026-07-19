import { describe, it, expect } from "vitest";
import { parseUsageLines, aggregateSeries, eventsToCsv } from "@/server/usage-series";
import type { UsageEvent } from "@/lib/usage-types";

// Timestamps built via the local-time Date constructor so assertions are
// timezone-independent (aggregation buckets by local calendar day).
const at = (y: number, m: number, d: number, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

const ev = (ts: number, extra: Partial<UsageEvent> = {}): UsageEvent => ({
  v: 2,
  ts,
  costUsd: 0.01,
  inTok: 100,
  outTok: 50,
  cacheTok: 1000,
  model: "claude-sonnet-5",
  project: "demo",
  status: "ok",
  ...extra,
});

const NOW = at(2026, 7, 19, 15);

describe("parseUsageLines", () => {
  it("skips blanks, malformed JSON and non-numeric ts; keeps v1 lines", () => {
    const v1 = `{"ts":${at(2026, 7, 18)},"costUsd":0.02,"inTok":10,"outTok":5,"cacheTok":0,"model":"claude-3"}`;
    const text = [
      "",
      "   ",
      "{not json",
      '{"ts":"nope","costUsd":1,"model":"x"}',
      '"just a string"',
      v1,
      JSON.stringify(ev(NOW)),
      "",
    ].join("\n");
    const events = parseUsageLines(text);
    expect(events).toHaveLength(2);
    expect(events[0].model).toBe("claude-3");
    expect(events[0].project).toBeUndefined();
  });
});

describe("aggregateSeries bucketing", () => {
  it("returns exactly `days` zero-filled buckets, oldest first", () => {
    const s = aggregateSeries([], 7, NOW);
    expect(s.buckets).toHaveLength(7);
    expect(s.buckets[0].day).toBe("2026-07-13");
    expect(s.buckets[6].day).toBe("2026-07-19");
    expect(s.buckets.every((b) => b.turns === 0 && b.costUsd === 0)).toBe(true);
  });

  it("puts 00:01 and 23:59 of the same local day in the same bucket", () => {
    const s = aggregateSeries([ev(at(2026, 7, 18, 0, 1)), ev(at(2026, 7, 18, 23, 59))], 7, NOW);
    const day = s.buckets.find((b) => b.day === "2026-07-18")!;
    expect(day.turns).toBe(2);
    expect(s.buckets.filter((b) => b.turns > 0)).toHaveLength(1);
  });

  it("excludes out-of-range events from buckets, breakdowns, status and totals", () => {
    const old = ev(at(2026, 7, 1), { project: "ancient", costUsd: 99 });
    const future = ev(NOW + 60_000, { project: "future" });
    const s = aggregateSeries([old, future, ev(NOW)], 7, NOW);
    expect(s.totals.turns).toBe(1);
    expect(s.totals.costUsd).toBeCloseTo(0.01);
    expect(s.byProject.map((r) => r.key)).toEqual(["demo"]);
    expect(s.status.ok).toBe(1);
    expect(s.buckets.reduce((n, b) => n + b.turns, 0)).toBe(1);
  });

  it("a 30-day range includes day 30 but not day 31", () => {
    const s = aggregateSeries([ev(at(2026, 6, 20)), ev(at(2026, 6, 19))], 30, NOW);
    expect(s.buckets).toHaveLength(30);
    expect(s.buckets[0].day).toBe("2026-06-20");
    expect(s.totals.turns).toBe(1);
  });
});

describe("aggregateSeries breakdowns and status", () => {
  it("groups v1 lines (no project/model/status) under empty key and counts them ok", () => {
    const v1: UsageEvent = { ts: NOW, costUsd: 0.5, inTok: 1, outTok: 1, cacheTok: 0, model: "" };
    const s = aggregateSeries([v1, ev(NOW)], 7, NOW);
    expect(s.status).toEqual({ ok: 2, error: 0, aborted: 0 });
    const blank = s.byProject.find((r) => r.key === "")!;
    expect(blank.turns).toBe(1);
    expect(blank.costUsd).toBeCloseTo(0.5);
  });

  it("counts errors/aborted per row and sorts by cost desc", () => {
    const s = aggregateSeries(
      [
        ev(NOW, { project: "a", costUsd: 0.1 }),
        ev(NOW, { project: "a", costUsd: 0, status: "error", durationMs: 0 }),
        ev(NOW, { project: "b", costUsd: 5, status: "aborted" }),
      ],
      7,
      NOW
    );
    expect(s.byProject.map((r) => r.key)).toEqual(["b", "a"]);
    const a = s.byProject[1];
    expect(a.errors).toBe(1);
    expect(a.aborted).toBe(0);
    expect(s.byProject[0].aborted).toBe(1);
    expect(s.status).toEqual({ ok: 1, error: 1, aborted: 1 });
  });

  it("averages only positive durations, null when none", () => {
    const s = aggregateSeries(
      [
        ev(NOW, { project: "p", durationMs: 1000 }),
        ev(NOW, { project: "p", durationMs: 3000 }),
        ev(NOW, { project: "p", status: "error", durationMs: 0 }),
        ev(NOW, { project: "q", durationMs: 0 }),
      ],
      7,
      NOW
    );
    expect(s.byProject.find((r) => r.key === "p")!.avgDurationMs).toBe(2000);
    expect(s.byProject.find((r) => r.key === "q")!.avgDurationMs).toBeNull();
  });
});

describe("eventsToCsv", () => {
  const HEADER = "ts,date,project,model,provider,sessionId,effort,status,subtype,costUsd,inTok,outTok,cacheTok,durationMs,numTurns";

  it("emits the header and one row per event", () => {
    const csv = eventsToCsv([ev(NOW)]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("demo");
    expect(lines[1]).toContain("2026-07-19 15:00:00");
  });

  it("quotes fields with commas/quotes/newlines", () => {
    const csv = eventsToCsv([ev(NOW, { project: 'we, "the" devs', sessionId: "a\nb" })]);
    expect(csv).toContain('"we, ""the"" devs"');
    expect(csv).toContain('"a\nb"');
  });

  it("prefixes formula-looking string fields with a quote", () => {
    const csv = eventsToCsv([ev(NOW, { project: "=cmd()", model: "+SUM(A1)" })]);
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain("'+SUM(A1)");
  });

  it("does not formula-prefix negative numbers", () => {
    const csv = eventsToCsv([ev(NOW, { costUsd: -1 })]);
    expect(csv).toContain(",-1,");
    expect(csv).not.toContain("'-1");
  });

  it("emits empty cells (not undefined) for missing v1 fields", () => {
    const v1: UsageEvent = { ts: NOW, costUsd: 0.02, inTok: 10, outTok: 5, cacheTok: 0, model: "claude-3" };
    const row = eventsToCsv([v1]).trimEnd().split("\n")[1];
    expect(row).not.toContain("undefined");
    expect(row.split(",")).toHaveLength(HEADER.split(",").length);
    expect(row).toMatch(/,claude-3,,,,,,0\.02,/);
  });
});
