import { z } from "zod";
import { tokenValid } from "@/server/security";
import { loadWorkspace, saveWorkspace } from "@/server/workspace-store";

export const runtime = "nodejs";

export function GET() {
  return Response.json(loadWorkspace());
}

const Schema = z.object({
  panels: z
    .array(
      z.object({
        projectPath: z.string(),
        selModel: z.string().nullable().optional(),
        effort: z.string().optional(),
        sessionId: z.string().nullable().optional(),
        roleLabel: z.string().optional(),
      }),
    )
    .max(8),
  activeIndex: z.number().int().min(0),
});

export async function PUT(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let w: z.infer<typeof Schema>;
  try {
    w = Schema.parse(await req.json());
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  saveWorkspace(w);
  return Response.json({ ok: true });
}
