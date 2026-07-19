"use client";

import { useState } from "react";
import { useT, useLang } from "@/i18n";
import type { SeriesBucket } from "@/lib/usage-types";

export type SeriesMetric = "cost" | "tokens" | "turns";

const W = 720;
const H = 190;
const PAD_L = 48;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 22;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function metricValue(b: SeriesBucket, metric: SeriesMetric): number {
  if (metric === "cost") return b.costUsd;
  if (metric === "tokens") return b.inTok + b.outTok;
  return b.turns;
}

/** Smallest 1/2/5 × 10^k ≥ max, for clean axis ticks. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

/** Column with 4px-rounded top corners, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

export function TimeSeriesChart({ buckets, metric, formatValue }: { buckets: SeriesBucket[]; metric: SeriesMetric; formatValue: (v: number) => string }) {
  const t = useT();
  const lang = useLang();
  const [hot, setHot] = useState<number | null>(null);

  const rawMax = Math.max(0, ...buckets.map((b) => metricValue(b, metric)));
  if (rawMax === 0) {
    return <div className="tschart-empty">{t("analyticsNoData")}</div>;
  }
  const max = niceMax(rawMax);
  const slot = PLOT_W / buckets.length;
  const barW = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => PAD_T + PLOT_H * (1 - v / max);
  const labelStep = Math.ceil(buckets.length / 4);
  const fmtDay = (ts: number) => new Date(ts).toLocaleDateString(lang, { day: "numeric", month: "short" });

  const hotBucket = hot !== null ? buckets[hot] : null;
  // Clamped so the tooltip never spills past the modal edges.
  const tipLeftPct = hot !== null ? Math.min(80, Math.max(20, ((PAD_L + (hot + 0.5) * slot) / W) * 100)) : 0;

  return (
    <div className="tschart-wrap">
      <svg className="tschart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("analyticsTitle")}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="ts-grid" />
            <text x={PAD_L - 6} y={y(v) + 3.5} className="ts-tick" textAnchor="end">
              {formatValue(v)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const v = metricValue(b, metric);
          if (v <= 0) return null;
          const h = Math.max(1.5, PLOT_H * (v / max));
          const x = PAD_L + i * slot + (slot - barW) / 2;
          return <path key={b.day} d={barPath(x, H - PAD_B - h, barW, h)} className={`ts-bar ${hot === i ? "hot" : ""}`} />;
        })}
        {buckets.map((b, i) =>
          i % labelStep === 0 ? (
            <text key={b.day} x={PAD_L + (i + 0.5) * slot} y={H - 6} className="ts-tick" textAnchor="middle">
              {fmtDay(b.ts)}
            </text>
          ) : null
        )}
        {/* Hover/focus layer: full-height hit targets, wider than the bars. */}
        {buckets.map((b, i) => (
          <rect
            key={b.day}
            x={PAD_L + i * slot}
            y={PAD_T}
            width={slot}
            height={PLOT_H}
            fill="transparent"
            tabIndex={0}
            aria-label={`${fmtDay(b.ts)}: ${formatValue(metricValue(b, metric))}`}
            onMouseEnter={() => setHot(i)}
            onMouseLeave={() => setHot(null)}
            onFocus={() => setHot(i)}
            onBlur={() => setHot(null)}
          />
        ))}
      </svg>
      {hotBucket && (
        <div className="tschart-tooltip" style={{ left: `${tipLeftPct}%` }}>
          <div className="tt-date">{new Date(hotBucket.ts).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" })}</div>
          <div className="tt-row">
            <b>~${hotBucket.costUsd.toFixed(3)}</b> {t("usageCost")}
          </div>
          <div className="tt-row">
            <b>{hotBucket.turns}</b> {t("usageTurns")}
          </div>
          <div className="tt-row">
            <b>{fmtTok(hotBucket.inTok)}</b> {t("analyticsTokIn")} · <b>{fmtTok(hotBucket.outTok)}</b> {t("analyticsTokOut")} · <b>{fmtTok(hotBucket.cacheTok)}</b> {t("analyticsTokCache")}
          </div>
          {(hotBucket.errors > 0 || hotBucket.aborted > 0) && (
            <div className="tt-row tt-bad">
              {hotBucket.errors > 0 && (
                <>
                  <b>{hotBucket.errors}</b> {t("statusError").toLowerCase()}{" "}
                </>
              )}
              {hotBucket.aborted > 0 && (
                <>
                  <b>{hotBucket.aborted}</b> {t("statusAborted").toLowerCase()}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function fmtTok(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}
