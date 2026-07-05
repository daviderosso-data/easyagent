import { z } from "zod";
import { tokenValid } from "@/server/security";
import { revealInOS } from "@/server/reveal";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let path: string;
  try {
    path = z.object({ path: z.string() }).parse(await req.json()).path;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  return Response.json({ ok: revealInOS(path) });
}
