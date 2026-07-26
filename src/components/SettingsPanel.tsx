"use client";

import { useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import type { MsgKey } from "@/i18n/messages";
import { detectProfile, type SecurityProfile, type Lang, type Theme } from "@/lib/settings";
import { ConnectionsSection } from "@/components/ConnectionsSection";
import { Icon } from "@/components/icons";

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
  const setNotifications = useAgent((s) => s.setNotifications);
  const [notifBlocked, setNotifBlocked] = useState(false);
  const token = useAgent((s) => s.token);
  const sec = settings.security;
  const activeProfile = detectProfile(sec);

  const [pendingOpen, setPendingOpen] = useState(false);
  const [openTyped, setOpenTyped] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accBusy, setAccBusy] = useState<string | null>(null);

  // P7 — app password state (set/change/remove) + logout.
  const setHttps = useAgent((s) => s.setHttps);
  // P7.1 — remote access (needs a password; implies https).
  const setRemoteAccess = useAgent((s) => s.setRemoteAccess);
  const [remote, setRemote] = useState<{
    wanted: boolean;
    active: boolean;
    needPassword: boolean;
    addresses: string[];
    port: string;
  } | null>(null);
  // Looked up only when asked: opening Settings must not call a third party.
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [ipBusy, setIpBusy] = useState(false);
  const [ipErr, setIpErr] = useState(false);

  const findPublicIp = async () => {
    setIpBusy(true);
    setIpErr(false);
    const d = await fetch("/api/remote/public-ip").then((r) => r.json()).catch(() => null);
    if (d?.ok && d.ip) setPublicIp(d.ip);
    else setIpErr(true);
    setIpBusy(false);
  };
  const [auth, setAuth] = useState<{ configured: boolean; authed: boolean } | null>(null);
  const [pwMode, setPwMode] = useState<null | "set" | "change" | "remove">(null);
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);

  const confirmWord = t("confirmWord");
  const headers = (): Record<string, string> => ({ "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) });

  const refreshAccount = () => fetch("/api/account/status").then((r) => r.json()).then(setAccount).catch(() => {});
  const refreshAuth = () => fetch("/api/auth/status").then((r) => r.json()).then(setAuth).catch(() => {});
  const refreshRemote = () => fetch("/api/remote/info").then((r) => r.json()).then(setRemote).catch(() => {});

  useEffect(() => {
    refreshAccount();
    void refreshAuth();
    void refreshRemote();
  }, []);

  const openPwMode = (m: "set" | "change" | "remove") => {
    setPwMode(m);
    setPwCur("");
    setPwNew("");
    setPwNew2("");
    setPwErr(null);
  };
  const submitPw = async () => {
    setPwErr(null);
    if (pwMode === "set" || pwMode === "change") {
      if (pwNew.length < 8) return setPwErr(t("setupShort"));
      if (pwNew !== pwNew2) return setPwErr(t("setupMismatch"));
    }
    const call = (url: string, body: object) =>
      fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body) }).catch(() => null);
    const r =
      pwMode === "set"
        ? await call("/api/auth/setup", { password: pwNew })
        : pwMode === "change"
          ? await call("/api/auth/password", { current: pwCur, next: pwNew })
          : await call("/api/auth/password", { current: pwCur, next: null });
    if (!r?.ok) return setPwErr(r?.status === 401 ? t("loginWrong") : t("toastAuthOps"));
    setPwMode(null);
    await refreshAuth();
  };
  const appLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", headers: headers() }).catch(() => {});
    window.location.href = "/login";
  };

  const toggleNotifications = async (on: boolean) => {
    if (on) {
      // Permission must be asked from a user gesture — this toggle is one.
      if (typeof Notification === "undefined") {
        setNotifBlocked(true);
        return;
      }
      let perm = Notification.permission;
      if (perm === "default") perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setNotifBlocked(true);
        return;
      }
    }
    setNotifBlocked(false);
    setNotifications(on);
  };

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
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="settings-body">
          {/* -------- Security -------- */}
          <section className="settings-section">
            <h3><Icon name="shield" size={15} /> {t("secSecurity")}</h3>
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

          {/* -------- P7 — Access (app password + HTTPS) -------- */}
          <section className="settings-section">
            <h3><Icon name="shield" size={15} /> {t("secAccess")}</h3>
            <p className="settings-sub">{auth?.configured ? t("accessPwOn") : t("accessPwOff")}</p>
            {pwMode === null ? (
              <div className="access-row">
                {auth?.configured ? (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => openPwMode("change")}>{t("accessChangePw")}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => openPwMode("remove")}>{t("accessRemovePw")}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => void appLogout()}>{t("accessLogout")}</button>
                  </>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => openPwMode("set")}>{t("accessSetPw")}</button>
                )}
              </div>
            ) : (
              <div className="access-form">
                {(pwMode === "change" || pwMode === "remove") && (
                  <input
                    className="field-input"
                    type="password"
                    autoFocus
                    placeholder={t("accessCurrentPw")}
                    value={pwCur}
                    onChange={(e) => setPwCur(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void submitPw()}
                  />
                )}
                {pwMode !== "remove" && (
                  <>
                    <input
                      className="field-input"
                      type="password"
                      autoFocus={pwMode === "set"}
                      placeholder={t("setupPw")}
                      value={pwNew}
                      onChange={(e) => setPwNew(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void submitPw()}
                    />
                    <input
                      className="field-input"
                      type="password"
                      placeholder={t("setupPw2")}
                      value={pwNew2}
                      onChange={(e) => setPwNew2(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void submitPw()}
                    />
                  </>
                )}
                {pwErr && <p className="red-warning">{pwErr}</p>}
                <div className="access-row">
                  <button className="btn btn-primary btn-sm" onClick={() => void submitPw()}>
                    {pwMode === "set" ? t("setupActivate") : pwMode === "change" ? t("accessChangePw") : t("accessRemovePw")}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPwMode(null)}>{t("cancel")}</button>
                </div>
              </div>
            )}
            <Toggle
              label={t("httpsLabel")}
              checked={settings.https}
              onChange={(v) => void setHttps(v)}
            />
            <p className="settings-sub">{t("httpsHint")}</p>

            {/* P7.1 — remote access. Gated on having a password. */}
            <Toggle
              label={t("remoteLabel")}
              checked={settings.remote}
              onChange={async (v) => {
                await setRemoteAccess(v);
                await refreshRemote();
              }}
            />
            <p className="settings-sub">{t("remoteHint")}</p>
            {!auth?.configured && <p className="red-warning">{t("remoteNeedPw")}</p>}
            {remote?.active && (
              <div className="remote-on">
                <Icon name="globe" size={13} /> {t("remoteOnBanner")}
              </div>
            )}
            {settings.remote && !remote?.active && <p className="settings-sub">{t("remoteWanted")}</p>}
            {settings.remote && remote && (
              <div className="remote-addr">
                <span className="settings-sub">{t("remoteReach")}</span>

                {remote.addresses.length > 0 && (
                  <>
                    <span className="addr-label">{t("remoteSameWifi")}</span>
                    {remote.addresses.map((ip) => (
                      <AddressRow key={ip} url={`https://${ip}:${remote.port}/m`} t={t} />
                    ))}
                  </>
                )}

                <span className="addr-label">{t("remoteOutside")}</span>
                {publicIp ? (
                  <>
                    <AddressRow url={`https://${publicIp}:${remote.port}/m`} t={t} />
                    <p className="remote-warn">{t("remotePortHint").replace("{p}", remote.port)}</p>
                  </>
                ) : (
                  <>
                    <button className="btn btn-ghost btn-sm" disabled={ipBusy} onClick={() => void findPublicIp()}>
                      {t("remoteFindIp")}
                    </button>
                    {ipErr && <p className="red-warning">{t("remoteIpFailed")}</p>}
                  </>
                )}

                <p className="remote-warn">{t("remoteWarn")}</p>
              </div>
            )}
          </section>

          {/* -------- Connections (MCP) -------- */}
          <ConnectionsSection />

          {/* -------- Language & appearance -------- */}
          <section className="settings-section">
            <h3><Icon name="globe" size={15} /> {t("secLanguage")}</h3>
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
            <Toggle label={t("notifLabel")} checked={settings.notifications} onChange={(v) => void toggleNotifications(v)} />
            <p className="settings-sub">{t("notifHint")}</p>
            {notifBlocked && <p className="red-warning">{t("notifDenied")}</p>}
          </section>

          {/* -------- Account -------- */}
          <section className="settings-section">
            <h3><Icon name="user" size={15} /> {t("secAccount")}</h3>
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
            <EngineAccounts headers={headers} />
          </section>
        </div>
      </div>
    </div>
  );
}

/** Login/logout rows for the non-default engines (Codex, Grok, …). The main
 *  Claude account keeps its richer block above; local engines (Ollama) have
 *  no account and don't appear here. */
function EngineAccounts({ headers }: { headers: () => Record<string, string> }) {
  const t = useT();
  const providers = useAgent((s) => s.providers);
  const loadProviders = useAgent((s) => s.loadProviders);
  const [busy, setBusy] = useState<string | null>(null);
  // GitHub device flow (Copilot): one-time code the user must enter in the browser.
  const [device, setDevice] = useState<{ id: string; url: string; code: string } | null>(null);

  const engines = providers.filter((p) => p.hasAccount && p.id !== "claude");
  if (!engines.length) return null;

  const act = async (id: string, action: "login" | "logout") => {
    setBusy(id);
    setDevice(null);
    try {
      const r = await fetch(`/api/account/${action}?provider=${encodeURIComponent(id)}`, { method: "POST", headers: headers() });
      const data = await r.json().catch(() => null);
      if (data?.pending && data.userCode) {
        setDevice({ id, url: data.verificationUrl || "https://github.com/login/device", code: data.userCode });
        window.open(data.verificationUrl || "https://github.com/login/device", "_blank");
        // Poll until the user approves in the browser (or ~3 minutes pass).
        for (let i = 0; i < 60; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          try {
            const s = await fetch(`/api/account/status?provider=${encodeURIComponent(id)}`, { headers: headers() });
            if ((await s.json())?.loggedIn) break;
          } catch {
            /* keep polling */
          }
        }
        setDevice(null);
      }
    } catch {
      /* row state refreshes below either way */
    }
    await loadProviders();
    setBusy(null);
  };

  return (
    <div className="account-info">
      <p className="settings-sub">
        <b>{t("otherEngines")}</b>
      </p>
      {engines.map((p) => (
        <div key={p.id}>
          <div className="row-actions">
            <span style={{ minWidth: "10rem" }}>{p.label}</span>
            {!p.status.installed ? (
              <span className="settings-sub">{t("notInstalled")}</span>
            ) : p.status.loggedIn ? (
              <>
                <span className="settings-sub">✓ {t("connected")}</span>
                {p.id === "copilot" ? (
                  // No logout exists in the Copilot CLI — switching accounts
                  // re-runs the device flow, which overwrites the credential.
                  <button className="btn btn-ghost" disabled={!!busy} onClick={() => act(p.id, "login")}>
                    {t("switchBtn")}
                  </button>
                ) : (
                  <button className="btn btn-ghost" disabled={!!busy} onClick={() => act(p.id, "logout")}>
                    {t("logoutBtn")}
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-soft" disabled={!!busy} onClick={() => act(p.id, "login")}>
                {busy === p.id ? t("loginHint") : t("loginBtn")}
              </button>
            )}
          </div>
          {device?.id === p.id && (
            <p className="settings-sub device-flow">
              {t("devFlowIntro")}{" "}
              <a href={device.url} target="_blank" rel="noreferrer">
                {device.url.replace(/^https?:\/\//, "")}
              </a>{" "}
              {t("devFlowCode")} <code className="device-code">{device.code}</code>
            </p>
          )}
        </div>
      ))}
      <EngineDoctor headers={headers} />
    </div>
  );
}

interface EngineDiag {
  id: string;
  label: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  loggedIn: boolean | null;
  fix: { kind: "install" | "login" | "start" | "auth"; command?: string } | null;
}

/** P6.9.5 — per-engine health check with the fix for whatever is broken. */
function EngineDoctor({ headers }: { headers: () => Record<string, string> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [engines, setEngines] = useState<EngineDiag[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/providers/doctor", { headers: headers() });
      setEngines(r.ok ? (await r.json()).engines : []);
    } catch {
      setEngines([]);
    }
    setBusy(false);
  };

  return (
    <div>
      <button
        className="link-btn"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && engines === null) void run();
        }}
      >
        {open ? "▾" : "▸"} {t("doctorTitle")}
      </button>
      {open && (
        <div className="advanced">
          {engines === null || busy ? (
            <p className="settings-sub">{t("doctorChecking")}</p>
          ) : (
            engines.map((e) => (
              <div key={e.id} className="doctor-row">
                <p>
                  {e.fix === null ? "✓" : "✗"} <b>{e.label}</b>
                  {e.version && <span className="settings-sub"> · {e.version}</span>}
                  {e.path === "npx" && <span className="settings-sub"> · {t("docNpxNote")}</span>}
                </p>
                {e.fix?.kind === "install" && (
                  <p className="settings-sub">
                    {t("docFixInstall")} <code>{e.fix.command}</code>
                  </p>
                )}
                {e.fix?.kind === "login" && <p className="settings-sub">{t("docFixLogin")}</p>}
                {e.fix?.kind === "auth" && (
                  <p className="settings-sub">
                    {t("docFixAuth")} <code>{e.fix.command}</code>
                  </p>
                )}
                {e.fix?.kind === "start" && (
                  <p className="settings-sub">
                    {t("docFixOllama")} <code>{e.fix.command}</code>
                  </p>
                )}
              </div>
            ))
          )}
          <button className="btn btn-soft btn-sm" disabled={busy} onClick={() => void run()}>
            {t("docRecheck")}
          </button>
        </div>
      )}
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

/** One address with a copy button — typing an https URL with a port on a phone
 *  is the kind of chore that makes a feature go unused. */
function AddressRow({ url, t }: { url: string; t: (k: MsgKey) => string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the address is selectable anyway */
    }
  };
  return (
    <div className="addr-row">
      <code>{url}</code>
      <button className="btn btn-ghost btn-sm" onClick={() => void copy()}>
        {copied ? t("remoteCopied") : t("remoteCopy")}
      </button>
    </div>
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

