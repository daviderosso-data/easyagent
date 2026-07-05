import { z } from "zod";
import { createProjectFolder } from "@/server/projects";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

const BodySchema = z.object({ parent: z.string(), name: z.string() });

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  return Response.json(createProjectFolder(body.parent, body.name));
}
