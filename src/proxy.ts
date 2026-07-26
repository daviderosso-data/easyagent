import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authState, sessionValid, SESSION_COOKIE } from "@/server/auth";
import { remoteEnabled } from "@/server/remote";

// Only loopback hosts may talk to the server. This — together with binding to
// 127.0.0.1 — defeats LAN access and DNS-rebinding (the attacker's page resolves
// to 127.0.0.1 but the browser still sends the attacker's Host/Origin).
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/i;

const isLoopback = (h: string | null): boolean => !!h && LOOPBACK_HOST.test(h.trim());

function reject(msg: string): NextResponse {
  return new NextResponse(msg, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function proxy(req: NextRequest): NextResponse {
  // P7.1 — with remote access on, the Host is whatever the phone dialled, so
  // "must be loopback" is replaced by "Origin/Referer must equal Host". That
  // keeps the CSRF property (a foreign page still can't forge a same-origin
  // request) while allowing the app to be reached from another device.
  const remote = remoteEnabled();
  const host = req.headers.get("host");
  const hostAllowed = (h: string | null): boolean =>
    remote ? !!h && !!host && h.trim().toLowerCase() === host.trim().toLowerCase() : isLoopback(h);

  // 1. Host must be loopback (or anything, when serving remotely).
  if (!remote && !isLoopback(host)) return reject("Accesso non consentito.");

  // 2. Browser cross-site requests are refused (blocks CSRF from any website).
  // Exemption per the standard Fetch-Metadata isolation policy: a top-level GET
  // navigation (user following a link into the app) is safe — every mutating
  // route is a token-gated POST — so only cross-site subresource/fetch/POST is
  // rejected. The exemption requires the Sec-Fetch-Mode header, so legacy
  // requests without fetch metadata still go through the Origin/Referer checks.
  const isTopLevelGetNav =
    req.method === "GET" &&
    req.headers.get("sec-fetch-mode") === "navigate" &&
    !["object", "embed"].includes(req.headers.get("sec-fetch-dest") ?? "");
  const secSite = req.headers.get("sec-fetch-site");
  if (secSite && !["same-origin", "same-site", "none"].includes(secSite) && !isTopLevelGetNav) {
    return reject("Origine non consentita.");
  }

  // 3. Origin / Referer (when present) must point at an allowed host —
  // loopback normally, the request's own host when serving remotely.
  const origin = req.headers.get("origin");
  if (origin && !isTopLevelGetNav) {
    try {
      if (!hostAllowed(new URL(origin).host)) return reject("Origine non consentita.");
    } catch {
      return reject("Origine non valida.");
    }
  }
  const referer = req.headers.get("referer");
  if (referer && !isTopLevelGetNav) {
    try {
      if (!hostAllowed(new URL(referer).host)) return reject("Origine non consentita.");
    } catch {
      /* ignore malformed referer */
    }
  }

  // 4. P7 — app-level auth gate. Active once a password is configured; before
  // the first-run choice (password or skip) only pages are steered to /login.
  const path = req.nextUrl.pathname;
  const openPath =
    path === "/login" ||
    path.startsWith("/api/auth/") ||
    path === "/api/session-token" || // anti-CSRF token, needed by /login itself
    path.startsWith("/_next/");
  if (!openPath) {
    const st = authState();
    if (st.configured) {
      if (!sessionValid(req.cookies.get(SESSION_COOKIE)?.value)) {
        if (path.startsWith("/api/")) return NextResponse.json({ error: "auth" }, { status: 401 });
        return NextResponse.redirect(new URL("/login", req.url));
      }
    } else if (!st.skipped && !path.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/login", req.url));
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
