import { tokenValid } from "@/server/security";
import { loadSessionItems } from "@/server/sessions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!tokenValid(req)) return Response.json({ items: [] }, { status: 403 });
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!sessionId) return Response.json({ items: [] });
  return Response.json({ items: await loadSessionItems(sessionId) });
}
