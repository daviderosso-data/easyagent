import { z } from "zod";
import { deleteEntry } from "@/server/fs-mutate";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

const BodySchema = z.object({ path: z.string() });

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "invalid-request" }, { status: 400 });
  }
  return Response.json(deleteEntry(body.path));
}
