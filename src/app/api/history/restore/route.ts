import { z } from "zod";
import { restoreSavePoint, projectRootFor } from "@/server/snapshots";
import { tokenValid, validateCwd } from "@/server/security";
import { sessionManager } from "@/server/session-manager";

export const runtime = "nodejs";

const Body = z.object({
  cwd: z.string(),
  hash: z.string().regex(/^[0-9a-f]{7,40}$/),
  lang: z.enum(["en", "it"]).default("en"),
});

const LABELS = {
  en: { safety: "Safety point (before going back)", restored: "Went back to an earlier save point" },
  it: { safety: "Punto di sicurezza (prima di tornare indietro)", restored: "Ritorno a un punto di salvataggio precedente" },
};

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const check = validateCwd(body.cwd);
  if (!check.ok) return Response.json({ ok: false }, { status: 400 });

  const projectRoot = projectRootFor(check.path!);
  if (!projectRoot) return Response.json({ ok: false }, { status: 400 });
  if (sessionManager.anyRunningUnder(projectRoot)) {
    return Response.json({ ok: false, error: "busy" }, { status: 409 });
  }
  return Response.json(await restoreSavePoint(check.path!, body.hash, LABELS[body.lang]));
}
