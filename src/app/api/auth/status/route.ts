// P7 — auth status for the client: is a password set, was setup skipped, and
// is THIS request authenticated. Also carries the UI language so the login
// page can localize before the store exists. Whitelisted in the proxy.

import { authState, readSessionId, sessionValid } from "@/server/auth";
import { loadSettings } from "@/server/settings-store";

export const runtime = "nodejs";

export function GET(req: Request) {
  const st = authState();
  // renew=true → the once-per-app-load status call slides the 30-day session.
  const authed = st.configured && sessionValid(readSessionId(req), true);
  return Response.json({ ...st, authed, lang: loadSettings().lang });
}
