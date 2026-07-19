import { readUsageSeries, RANGE_DAYS, type RangeDays } from "@/server/usage-series";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

export function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const n = Number(new URL(req.url).searchParams.get("days"));
  const days: RangeDays = (RANGE_DAYS as readonly number[]).includes(n) ? (n as RangeDays) : 30;
  return Response.json(readUsageSeries(days));
}
