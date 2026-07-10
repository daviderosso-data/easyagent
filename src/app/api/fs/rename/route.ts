import { z } from "zod";
import { renameEntry } from "@/server/fs-mutate";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

const BodySchema = z.object({ path: z.string(), newName: z.string() });

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "invalid-request" }, { status: 400 });
  }
  return Response.json(renameEntry(body.path, body.newName));
}
