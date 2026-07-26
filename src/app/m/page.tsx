"use client";

// P7.1 — the phone view. Deliberately tiny: what is running, and the approvals
// waiting for a human. No editor, no transcript, no way to start a turn.
// Standalone like /login (no store): it polls /api/remote/state.

import { useCallback, useEffect, useState } from "react";
import { messages, type MsgKey } from "@/i18n/messages";
import type { Lang } from "@/lib/settings";
import { Icon } from "@/components/icons";

interface TurnRow {
  turnId: string;
  name: string;
  pending: number;
}
interface ApprovalRow {
  approvalId: string;
  turnId: string;
  toolName: string;
  title: string;
  target?: string;
  risk: "normal" | "red";
  severity: string;
  name: string;
}

const POLL_MS = 2500;

export default function RemotePage() {
  const [lang, setLang] = useState<Lang>("en");
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRed, setConfirmRed] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const t = (k: MsgKey) => messages[lang]?.[k] ?? messages.en[k];

  const load = useCallback(async () => {
    const d = await fetch("/api/remote/state").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!d) return;
    setTurns(d.turns ?? []);
    setApprovals(d.approvals ?? []);
    setReady(true);
  }, []);

  useEffect(() => {
    void (async () => {
      const [tk, st] = await Promise.all([
        fetch("/api/session-token").then((r) => r.json()).catch(() => ({})),
        fetch("/api/auth/status").then((r) => r.json()).catch(() => null),
      ]);
      if (tk?.token) setToken(tk.token);
      if (st?.lang) setLang(st.lang);
      await load();
    })();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const decide = async (a: ApprovalRow, decision: "allow" | "deny") => {
    if (busy) return;
    // A red action needs one deliberate extra tap — a stray touch must not
    // authorize something destructive.
    if (decision === "allow" && a.risk === "red" && confirmRed !== a.approvalId) {
      setConfirmRed(a.approvalId);
      return;
    }
    setBusy(a.approvalId);
    setErr(false);
    const r = await fetch("/api/chat/approve", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) },
      body: JSON.stringify({ turnId: a.turnId, approvalId: a.approvalId, decision }),
    }).catch(() => null);
    if (!r?.ok) setErr(true);
    setConfirmRed(null);
    setBusy(null);
    await load();
  };

  return (
    <div className="rm-wrap">
      <header className="rm-head">
        <span className="rm-brand">
          <Icon name="shield" size={16} /> easyagent
        </span>
        <button className="rm-refresh" onClick={() => void load()} aria-label={t("remoteRefresh")}>
          {t("remoteRefresh")}
        </button>
      </header>

      <main className="rm-main">
        {err && <p className="rm-err">{t("remoteFailed")}</p>}

        <h2 className="rm-h2">{t("inboxTitle")}</h2>
        {!ready ? (
          <p className="rm-empty">…</p>
        ) : approvals.length === 0 ? (
          <p className="rm-empty">{t("remoteNoApprovals")}</p>
        ) : (
          <ul className="rm-list">
            {approvals.map((a) => (
              <li key={a.approvalId} className={`rm-card ${a.risk === "red" ? "rm-card-red" : ""}`}>
                <div className="rm-card-top">
                  <span className="rm-session">{a.name}</span>
                  {a.risk === "red" && <span className="rm-risk">!</span>}
                </div>
                <p className="rm-title">{a.title || a.toolName}</p>
                {a.target && <p className="rm-target">{a.target}</p>}
                {confirmRed === a.approvalId ? (
                  <>
                    <p className="rm-confirm">{t("remoteRedConfirm")}</p>
                    <div className="rm-actions">
                      <button className="rm-btn rm-btn-red" disabled={busy === a.approvalId} onClick={() => void decide(a, "allow")}>
                        {t("remoteConfirmYes")}
                      </button>
                      <button className="rm-btn rm-btn-ghost" onClick={() => setConfirmRed(null)}>
                        {t("cancel")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="rm-actions">
                    <button className="rm-btn rm-btn-ok" disabled={busy === a.approvalId} onClick={() => void decide(a, "allow")}>
                      {t("remoteApprove")}
                    </button>
                    <button className="rm-btn rm-btn-ghost" disabled={busy === a.approvalId} onClick={() => void decide(a, "deny")}>
                      {t("remoteDeny")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <h2 className="rm-h2">{t("sessions")}</h2>
        {!ready ? (
          <p className="rm-empty">…</p>
        ) : turns.length === 0 ? (
          <p className="rm-empty">{t("remoteNothing")}</p>
        ) : (
          <ul className="rm-list">
            {turns.map((s) => (
              <li key={s.turnId} className="rm-card rm-card-flat">
                <span className="rm-session">{s.name || "—"}</span>
                <span className="rm-run">
                  <span className="session-dot" /> {t("remoteRunning")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
