// P7.1 — remote access (phone). Off by default. When on, the server binds all
// interfaces instead of loopback, so the safety floor is raised in exchange:
// an app password MUST exist and HTTPS MUST be on. Both are enforced in the
// settings route before the flag can be stored, and re-checked at boot.

import { networkInterfaces } from "node:os";
import { authState } from "@/server/auth";
import { certReady } from "@/server/tls";
import { loadSettings } from "@/server/settings-store";

/** Requirements for turning remote access on. Never bypassable from the UI. */
export function remotePreconditions(): { ok: boolean; needPassword: boolean; needTls: boolean } {
  const needPassword = !authState().configured;
  const needTls = !certReady();
  return { ok: !needPassword && !needTls, needPassword, needTls };
}

/** Remote is only "on" when the flag AND its preconditions hold — a settings
 *  file edited by hand (or a deleted certificate) must not open the door. */
export function remoteEnabled(): boolean {
  try {
    const s = loadSettings();
    return s.remote === true && s.https === true && remotePreconditions().ok;
  } catch {
    return false;
  }
}

/** Non-loopback IPv4 addresses, so the UI can show where to reach the app. */
export function localAddresses(): string[] {
  const out: string[] = [];
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
      }
    }
  } catch {
    /* best effort */
  }
  return out;
}
