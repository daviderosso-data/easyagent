// P6.9.9 — raw image bytes for the in-app viewer. Confined to the projects
// root, image extensions only, size-capped; served inert (nosniff + CSP).

import { readFileSync, statSync } from "node:fs";
import { realWithinProjectsRoot } from "@/server/projects";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function GET(req: Request) {
  if (!tokenValid(req)) return new Response(null, { status: 403 });
  const path = new URL(req.url).searchParams.get("path");
  if (!path || !realWithinProjectsRoot(path)) return new Response(null, { status: 404 });
  const type = TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) return new Response(null, { status: 404 });
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(readFileSync(path)), {
      headers: {
        "content-type": type,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
