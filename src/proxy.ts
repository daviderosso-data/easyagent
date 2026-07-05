import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Only loopback hosts may talk to the server. This — together with binding to
// 127.0.0.1 — defeats LAN access and DNS-rebinding (the attacker's page resolves
// to 127.0.0.1 but the browser still sends the attacker's Host/Origin).
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i;

function hostAllowed(h: string | null): boolean {
  return !!h && LOOPBACK_HOST.test(h.trim());
}

function reject(msg: string): NextResponse {
  return new NextResponse(msg, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function proxy(req: NextRequest): NextResponse {
  // 1. Host must be loopback.
  if (!hostAllowed(req.headers.get("host"))) return reject("Accesso non consentito.");

  // 2. Browser cross-site requests are refused (blocks CSRF from any website).
  const secSite = req.headers.get("sec-fetch-site");
  if (secSite && !["same-origin", "same-site", "none"].includes(secSite)) {
    return reject("Origine non consentita.");
  }

  // 3. Origin / Referer (when present) must point at a loopback host.
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (!hostAllowed(new URL(origin).host)) return reject("Origine non consentita.");
    } catch {
      return reject("Origine non valida.");
    }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (!hostAllowed(new URL(referer).host)) return reject("Origine non consentita.");
    } catch {
      /* ignore malformed referer */
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set(
    "Content-Security-Policy",
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; connect-src 'self'",
  );
  return res;
}

export const config = {
  // Apply to everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
