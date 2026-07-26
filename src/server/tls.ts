// P7 — self-signed TLS certificate for the local server (~/.easyagent/tls).
// Generated once via the system openssl when the HTTPS toggle is enabled;
// server.mjs reads the files at boot. Nothing here runs unless asked.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const tlsDir = () => join(process.env.EASYAGENT_DIR || join(homedir(), ".easyagent"), "tls");
export const certPath = () => join(tlsDir(), "cert.pem");
export const keyPath = () => join(tlsDir(), "key.pem");

export function certReady(): boolean {
  return existsSync(certPath()) && existsSync(keyPath());
}

/** Create the cert if missing. 825 days (Apple's trust cap for self-signed). */
export function ensureCert(): { ok: boolean; error?: string } {
  if (certReady()) return { ok: true };
  try {
    mkdirSync(tlsDir(), { recursive: true });
    const r = spawnSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "825", "-nodes",
        "-keyout", keyPath(), "-out", certPath(),
        "-subj", "/CN=easyagent",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
      ],
      { timeout: 20_000 },
    );
    if (r.status !== 0) return { ok: false, error: r.stderr?.toString() || "openssl failed" };
    chmodSync(keyPath(), 0o600);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "openssl not available" };
  }
}
