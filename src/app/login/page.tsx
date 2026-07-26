"use client";

// P7 — the one gate screen. Two modes:
//  • first run (no password, not skipped): "Protect easyagent" — create a
//    password or continue without one (remembered, shown once);
//  • password set: plain sign-in.
// Standalone on purpose: no store, localized via /api/auth/status's lang.

import { useEffect, useState } from "react";
import { messages, type MsgKey } from "@/i18n/messages";
import type { Lang } from "@/lib/settings";
import { Icon } from "@/components/icons";

interface AuthStatus {
  configured: boolean;
  skipped: boolean;
  authed: boolean;
  lang: Lang;
}

export default function LoginPage() {
  const [st, setSt] = useState<AuthStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [s, tk] = await Promise.all([
        fetch("/api/auth/status").then((r) => r.json()).catch(() => null),
        fetch("/api/session-token").then((r) => r.json()).catch(() => ({})),
      ]);
      if (tk?.token) setToken(tk.token);
      if (s?.authed) {
        window.location.replace("/");
        return;
      }
      setSt(s ?? { configured: false, skipped: false, authed: false, lang: "en" });
    })();
  }, []);

  if (!st) return null;
  const t = (k: MsgKey) => messages[st.lang]?.[k] ?? messages.en[k];
  const headers: Record<string, string> = { "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) };

  const login = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/auth/login", { method: "POST", headers, body: JSON.stringify({ password: pw }) })
      .catch(() => null);
    if (r?.ok) {
      window.location.replace("/");
      return;
    }
    if (r?.status === 429) {
      const d = await r.json().catch(() => ({}));
      setErr(t("loginWait").replace("{s}", String(d.retryAfter ?? "60")));
    } else {
      setErr(t("loginWrong"));
    }
    setBusy(false);
  };

  const setup = async () => {
    if (busy) return;
    if (pw.length < 8) return setErr(t("setupShort"));
    if (pw !== pw2) return setErr(t("setupMismatch"));
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/auth/setup", { method: "POST", headers, body: JSON.stringify({ password: pw }) })
      .catch(() => null);
    if (r?.ok) {
      window.location.replace("/");
      return;
    }
    setErr(t("toastAuthOps"));
    setBusy(false);
  };

  const skip = async () => {
    if (busy) return;
    setBusy(true);
    await fetch("/api/auth/setup", { method: "POST", headers, body: JSON.stringify({ skip: true }) }).catch(() => null);
    window.location.replace("/");
  };

  const submit = st.configured ? login : setup;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <Icon name="shield" size={22} />
          <h1>{st.configured ? t("loginTitle") : t("setupTitle")}</h1>
        </div>
        {!st.configured && <p className="login-intro">{t("setupIntro")}</p>}

        <input
          className="field-input"
          type="password"
          autoFocus
          placeholder={st.configured ? t("loginPw") : t("setupPw")}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        {!st.configured && (
          <input
            className="field-input"
            type="password"
            placeholder={t("setupPw2")}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        )}
        {err && <p className="login-err">{err}</p>}

        <button className="btn btn-primary full-btn" disabled={busy || !pw} onClick={() => void submit()}>
          {st.configured ? t("loginEnter") : t("setupActivate")}
        </button>
        {!st.configured && (
          <button className="link-btn login-skip" disabled={busy} onClick={() => void skip()}>
            {t("setupSkip")}
          </button>
        )}
      </div>
    </div>
  );
}
