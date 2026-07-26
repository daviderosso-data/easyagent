// P7.1 — what Settings → Access needs to show: whether remote access is on,
// what still blocks it, and the addresses to type into the phone.

import { localAddresses, remoteEnabled, remotePreconditions } from "@/server/remote";
import { loadSettings } from "@/server/settings-store";

export const runtime = "nodejs";

export function GET() {
  const s = loadSettings();
  const pre = remotePreconditions();
  return Response.json({
    // The stored intent vs. what is actually serving right now: the flag only
    // takes effect on restart, so "active" comes from the running server, not
    // from the settings file. Dev (`next dev`) has no flag and is never remote.
    wanted: s.remote === true,
    active: process.env.EASYAGENT_REMOTE_SERVING === "1" && remoteEnabled(),
    needPassword: pre.needPassword,
    needTls: pre.needTls,
    addresses: localAddresses(),
    port: process.env.PORT || "3000",
  });
}
