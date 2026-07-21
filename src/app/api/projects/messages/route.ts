import { tokenValid } from "@/server/security";
import { defaultProvider } from "@/server/providers";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ items: [] }, { status: 403 });
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!sessionId) return Response.json({ items: [] });
  const history = defaultProvider().history;
  return Response.json({ items: history ? await history.loadSessionItems(sessionId) : [] });
}
