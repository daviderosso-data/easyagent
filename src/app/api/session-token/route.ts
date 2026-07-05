import { SESSION_TOKEN } from "@/server/security";

export const runtime = "nodejs";

// Returns the per-process token. Reachable only same-origin (the middleware
// blocks cross-site callers), so a hostile web page cannot read it.
export function GET() {
  return Response.json({ token: SESSION_TOKEN });
}
