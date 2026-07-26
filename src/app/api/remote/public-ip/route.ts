// P7.2 — the address to reach this machine from OUTSIDE the local network.
// Only a router can know it, so it is asked of an external echo service — and
// only on demand (a button in Settings), never on page load: opening Settings
// must not quietly call a third party.

export const runtime = "nodejs";

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]{3,45}$/i;

export async function GET() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch("https://api.ipify.org", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!r.ok) return Response.json({ ok: false }, { status: 502 });
    // Remote output: only ever render it after it proves to be a bare address.
    const ip = (await r.text()).trim();
    if (!IPV4.test(ip) && !IPV6.test(ip)) return Response.json({ ok: false }, { status: 502 });
    return Response.json({ ok: true, ip });
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
