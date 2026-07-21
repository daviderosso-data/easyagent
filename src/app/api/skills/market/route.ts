import { searchSkillsMarket } from "@/server/marketplace";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json(await searchSkillsMarket(q));
}
