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
        project: z.string().optional(),
        provider: z.string().optional(),
        color: z.string().max(20).optional(),
        selModel: z.string().nullable().optional(),
        effort: z.string().optional(),
        sessionId: z.string().nullable().optional(),
        roleLabel: z.string().optional(),
      }),
    )
    // MAX_PANELS (src/store/agent.ts) is now per pinned project; the global
    // cap only bounds the persisted file size.
    .max(60),
  activeIndex: z.number().int().min(0),
  openProjects: z.array(z.string()).max(20).optional(),
  activeProject: z.string().optional(),
  viewMode: z.enum(["split", "tabs"]).optional(),
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
