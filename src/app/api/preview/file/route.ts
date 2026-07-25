// P6.11.6 — preview a single HTML file from the tree: serve it from the
// project's separate-origin static server and hand back the deep URL.

import { realpathSync } from "node:fs";
import { sep } from "node:path";
import { fileStaticBaseUrl } from "@/server/preview-manager";
import { projectRootFor } from "@/server/snapshots";
import { tokenValid, validateCwd } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ ok: false }, { status: 403 });
  let body: { cwd?: unknown; path?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const check = validateCwd(body.cwd);
  if (!check.ok || !check.path || typeof body.path !== "string") return Response.json({ ok: false }, { status: 400 });
  const root = projectRootFor(check.path);
  if (!root) return Response.json({ ok: false }, { status: 400 });
  let file: string;
  try {
    file = realpathSync(body.path);
  } catch {
    return Response.json({ ok: false }, { status: 404 });
  }
  const realRoot = realpathSync(root);
  if (!file.startsWith(realRoot + sep) || !/\.html?$/i.test(file)) {
    return Response.json({ ok: false }, { status: 400 });
  }
  const base = await fileStaticBaseUrl(realRoot);
  if (!base) return Response.json({ ok: false }, { status: 500 });
  const rel = file.slice(realRoot.length + 1).split(sep).map(encodeURIComponent).join("/");
  return Response.json({ ok: true, url: `${base}/${rel}` });
}
