"use client";

import { useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { detectProfile, type SecurityProfile, type Lang, type Theme } from "@/lib/settings";
import { ConnectionsSection } from "@/components/ConnectionsSection";

interface AccountData {
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const settings = useAgent((s) => s.settings);
  const applyProfile = useAgent((s) => s.applyProfile);
  const updateSecurity = useAgent((s) => s.updateSecurity);
  const setLang = useAgent((s) => s.setLang);
  const lang = useAgent((s) => s.lang);
  const theme = useAgent((s) => s.settings.theme);
  const setTheme = useAgent((s) => s.setTheme);
  const token = useAgent((s) => s.token);
  const sec = settings.security;
  const activeProfile = detectProfile(sec);

  const [pendingOpen, setPendingOpen] = useState(false);
  const [openTyped, setOpenTyped] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accBusy, setAccBusy] = useState<string | null>(null);

  const confirmWord = t("confirmWord");
  const headers = (): Record<string, string> => ({ "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) });

  const refreshAccount = () => fetch("/api/account/status").then((r) => r.json()).then(setAccount).catch(() => {});

  useEffect(() => {
    refreshAccount();
  }, []);

  const chooseProfile = (p: SecurityProfile) => {
    if (p === "open") {
      setPendingOpen(true);
      setOpenTyped("");
      return;
    }
    applyProfile(p);
  };
  const confirmOpen = () => {
    if (openTyped.trim().toUpperCase() !== confirmWord) return;
    applyProfile("open");
    setPendingOpen(false);
  };

  const doLogout = async () => {
    setAccBusy("logout");
    await fetch("/api/account/logout", { method: "POST", headers: headers() });
    await refreshAccount();
    setAccBusy(null);
  };
  const doLogin = async () => {
    setAccBusy("login");
    const r = await fetch("/api/account/login", { method: "POST", headers: headers() });
    setAccount(await r.json());
    setAccBusy(null);
  };
  const doSwitch = async () => {
    setAccBusy("login");
    await fetch("/api/account/logout", { method: "POST", headers: headers() });
    const r = await fetch("/api/account/login", { method: "POST", headers: headers() });
    setAccount(await r.json());
    setAccBusy(null);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal">
        <div className="settings-head">
          <h2>{t("settings")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          {/* -------- Security -------- */}
          <section className="settings-section">
            <h3>🛡️ {t("secSecurity")}</h3>
            <p className="settings-sub">{t("securityProfile")}</p>
            <div className="profile-cards">
              <ProfileCard id="locked" active={activeProfile === "locked"} title={t("profileLocked")} desc={t("profileLockedDesc")} onClick={() => chooseProfile("locked")} />
              <ProfileCard id="standard" active={activeProfile === "standard"} title={t("profileStandard")} desc={t("profileStandardDesc")} onClick={() => chooseProfile("standard")} />
              <ProfileCard id="open" active={activeProfile === "open"} danger title={t("profileOpen")} desc={t("profileOpenDesc")} onClick={() => chooseProfile("open")} />
            </div>

            {pendingOpen && (
              <div className="open-confirm">
                <p className="red-warning">{t("openWarning")}</p>
                <label className="confirm-field">
                  <span>
                    {t("typeToConfirm")} <b>{confirmWord}</b>:
                  </span>
                  <input className="field-input" value={openTyped} spellCheck={false} onChange={(e) => setOpenTyped(e.target.value)} placeholder={confirmWord} />
                </label>
                <div className="row-actions">
                  <button className="btn btn-ghost" onClick={() => setPendingOpen(false)}>
                    {t("deny")}
                  </button>
                  <button className="btn btn-danger" disabled={openTyped.trim().toUpperCase() !== confirmWord} onClick={confirmOpen}>
                    {t("proceedRed")}
                  </button>
                </div>
              </div>
            )}

            <button className="link-btn" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? "▾" : "▸"} {t("advanced")}
            </button>
            {showAdvanced && (
              <div className="advanced">
                <Toggle label={t("optSandbox")} checked={sec.sandbox} onChange={(v) => updateSecurity({ sandbox: v })} />
                <Toggle label={t("optCatastrophic")} checked={sec.blockCatastrophic} onChange={(v) => updateSecurity({ blockCatastrophic: v })} />
                <Toggle label={t("optSecrets")} checked={sec.blockSecrets} onChange={(v) => updateSecurity({ blockSecrets: v })} />
                <Toggle label={t("optConfine")} checked={sec.confineToFolder} onChange={(v) => updateSecurity({ confineToFolder: v })} />
                <label className="select-row">
                  <span>{t("optInstallNetwork")}</span>
                  <select className="field-input" value={sec.installNetwork} onChange={(e) => updateSecurity({ installNetwork: e.target.value as typeof sec.installNetwork })}>
                    <option value="block">{t("inBlock")}</option>
                    <option value="red">{t("inRed")}</option>
                    <option value="normal">{t("inNormal")}</option>
                    <option value="off">{t("inOff")}</option>
                  </select>
                </label>
                <label className="select-row">
                  <span>{t("optBehavior")}</span>
                  <select className="field-input" value={sec.behavior} onChange={(e) => updateSecurity({ behavior: e.target.value as typeof sec.behavior })}>
                    <option value="ask">{t("behAsk")}</option>
                    <option value="auto">{t("behAuto")}</option>
                    <option value="open">{t("behOpen")}</option>
                  </select>
                </label>
              </div>
            )}
          </section>

          {/* -------- Connections (MCP) -------- */}
          <ConnectionsSection />

          {/* -------- Language & appearance -------- */}
          <section className="settings-section">
            <h3>🌐 {t("secLanguage")}</h3>
            <label className="select-row">
              <span>{t("languageLabel")}</span>
              <select className="field-input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                <option value="en">{t("langEn")}</option>
                <option value="it">{t("langIt")}</option>
              </select>
            </label>
            <label className="select-row">
              <span>{t("appearance")}</span>
              <select className="field-input" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                <option value="system">{t("themeSystem")}</option>
                <option value="light">{t("themeLight")}</option>
                <option value="dark">{t("themeDark")}</option>
              </select>
            </label>
          </section>

          {/* -------- Account -------- */}
          <section className="settings-section">
            <h3>👤 {t("secAccount")}</h3>
            {account?.loggedIn ? (
              <div className="account-info">
                {account.email && (
                  <p>
                    {t("loggedInAs")} <b>{account.email}</b>
                  </p>
                )}
                {account.subscriptionType && (
                  <p className="settings-sub">
                    {t("plan")}: {account.subscriptionType}
                  </p>
                )}
                <div className="row-actions">
                  <button className="btn btn-ghost" disabled={!!accBusy} onClick={doLogout}>
                    {t("logoutBtn")}
                  </button>
                  <button className="btn btn-soft" disabled={!!accBusy} onClick={doSwitch}>
                    {t("switchBtn")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="account-info">
                <p className="settings-sub">{t("notLoggedIn")}</p>
                <button className="btn btn-primary" disabled={!!accBusy} onClick={doLogin}>
                  {t("loginBtn")}
                </button>
              </div>
            )}
            {accBusy === "login" && <p className="settings-sub">{t("loginHint")}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ active, danger, title, desc, onClick }: { id: string; active: boolean; danger?: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button className={`profile-card ${active ? "active" : ""} ${danger ? "danger" : ""}`} onClick={onClick}>
      <span className="profile-radio">{active ? "●" : "○"}</span>
      <span className="profile-title">{title}</span>
      <span className="profile-desc">{desc}</span>
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

