import { defaultProvider } from "@/server/providers";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized" }, { status: 403 });
  await defaultProvider().account?.logout();
  return Response.json({ ok: true });
}
