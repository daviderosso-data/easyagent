import { readUsageEvents, eventsToCsv } from "@/server/usage-series";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

export function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  return new Response(eventsToCsv(readUsageEvents()), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="easyagent-usage.csv"',
    },
  });
}
