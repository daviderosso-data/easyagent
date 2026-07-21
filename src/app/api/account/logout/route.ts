import { getProvider } from "@/server/providers";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized" }, { status: 403 });
  const provider = getProvider(new URL(req.url).searchParams.get("provider"));
  await provider?.account?.logout();
  return Response.json({ ok: true });
}
