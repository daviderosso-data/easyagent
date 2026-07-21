import { searchMcpMarket } from "@/server/marketplace";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 90; // the official registry can take >30s to answer

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json(await searchMcpMarket(q));
}
