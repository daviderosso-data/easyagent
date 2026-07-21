"use client";

import { useCallback, useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import type { MsgKey } from "@/i18n/messages";

interface ConnEntry {
  id: string;
  name: string;
  kind: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  presetId?: string;
  status?: string;
  statusError?: string;
}

interface PresetInfo {
  id: string;
  name: string;
  requiresToken: boolean;
}

const PRESET_DESC: Record<string, MsgKey> = {
  chrome: "presetChromeDesc",
  github: "presetGithubDesc",
  filesystem: "presetFilesDesc",
  memory: "presetMemoryDesc",
};

interface KeySpec {
  name: string;
  required: boolean;
  secret: boolean;
}
interface MarketHit {
  name: string;
  short: string;
  description: string;
  repository?: string;
  config:
    | { kind: "stdio"; command: string; args: string[]; envKeys: KeySpec[] }
    | { kind: "http" | "sse"; url: string; headerKeys: KeySpec[] };
}

const SECRETISH = /token|key|secret|pass|auth/i;

interface KV {
  k: string;
  v: string;
}

const kvToObj = (rows: KV[]): Record<string, string> =>
  Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]));

export function ConnectionsSection() {
  const t = useT();
  const token = useAgent((s) => s.token);
  const [servers, setServers] = useState<ConnEntry[]>([]);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [locked, setLocked] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; error?: string; toolCount?: number } | null>(null);
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [tokenVal, setTokenVal] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  // manual form state
  const [fName, setFName] = useState("");
  const [fKind, setFKind] = useState<"stdio" | "url">("stdio");
  const [fSse, setFSse] = useState(false);
  const [fCommand, setFCommand] = useState("");
  const [fArgs, setFArgs] = useState("");
  const [fUrl, setFUrl] = useState("");
  const [fKv, setFKv] = useState<KV[]>([]);
  // MCP marketplace (official registry — slow, so search is explicit)
  const [mq, setMq] = useState("");
  const [mkt, setMkt] = useState<MarketHit[] | null>(null);
  const [mktBusy, setMktBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const headers = useCallback(
    (): Record<string, string> => ({ "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) }),
    [token]
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/mcp", { headers: headers() });
      if (!r.ok) return;
      const d = await r.json();
      setServers(d.servers ?? []);
      setPresets(d.presets ?? []);
      setLocked(!!d.locked);
    } catch {
      /* ignore */
    }
  }, [headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const errKey = (code?: string): MsgKey =>
    code === "duplicate" ? "connDupName" : code === "bad-name" ? "connBadName" : "connBadFields";

  const addPreset = async (presetId: string, tok?: string) => {
    setFormErr(null);
    const r = await fetch("/api/mcp", { method: "POST", headers: headers(), body: JSON.stringify({ preset: presetId, token: tok }) });
    const d = await r.json();
    if (!d.ok) setFormErr(t(errKey(d.error)));
    setTokenFor(null);
    setTokenVal("");
    await refresh();
  };

  const submitManual = async () => {
    setFormErr(null);
    const entry =
      fKind === "stdio"
        ? { name: fName.trim(), kind: "stdio", command: fCommand.trim(), args: fArgs.split("\n").map((a) => a.trim()).filter(Boolean), env: kvToObj(fKv) }
        : { name: fName.trim(), kind: fSse ? "sse" : "http", url: fUrl.trim(), headers: kvToObj(fKv) };
    const r = await fetch("/api/mcp", { method: "POST", headers: headers(), body: JSON.stringify({ entry }) });
    const d = await r.json();
    if (!d.ok) {
      setFormErr(t(errKey(d.error)));
      return;
    }
    setShowForm(false);
    setFName("");
    setFCommand("");
    setFArgs("");
    setFUrl("");
    setFKv([]);
    await refresh();
  };

  const toggle = async (e: ConnEntry) => {
    await fetch("/api/mcp", { method: "PUT", headers: headers(), body: JSON.stringify({ id: e.id, patch: { enabled: !e.enabled } }) });
    await refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/mcp?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
    setConfirmDel(null);
    await refresh();
  };

  const test = async (e: ConnEntry) => {
    setTesting(e.id);
    setTestResult(null);
    try {
      const r = await fetch("/api/mcp/test", { method: "POST", headers: headers(), body: JSON.stringify({ id: e.id }) });
      const d = await r.json();
      setTestResult({ id: e.id, ok: !!d.ok, error: d.error, toolCount: d.toolCount });
    } catch {
      setTestResult({ id: e.id, ok: false });
    }
    setTesting(null);
    await refresh();
  };

  const searchMarket = async () => {
    if (mq.trim().length < 2) {
      setMkt(null);
      return;
    }
    setMktBusy(true);
    try {
      const r = await fetch(`/api/mcp/market?q=${encodeURIComponent(mq.trim())}`, { headers: headers() });
      const d = await r.json();
      setMkt(d.ok ? d.servers : []);
    } catch {
      setMkt([]);
    }
    setMktBusy(false);
  };

  const needsSetup = (h: MarketHit) =>
    h.config.kind === "stdio" ? h.config.envKeys.some((k) => k.required) : h.config.headerKeys.some((k) => k.required);

  const addFromMarket = async (h: MarketHit) => {
    if (needsSetup(h)) {
      // Pre-fill the manual form so the user only types the missing keys.
      setShowForm(true);
      setFName(h.short);
      if (h.config.kind === "stdio") {
        setFKind("stdio");
        setFCommand(h.config.command);
        setFArgs(h.config.args.join("\n"));
        setFKv(h.config.envKeys.map((k) => ({ k: k.name, v: "" })));
      } else {
        setFKind("url");
        setFSse(h.config.kind === "sse");
        setFUrl(h.config.url);
        setFKv(h.config.headerKeys.map((k) => ({ k: k.name, v: "" })));
      }
      return;
    }
    setAdding(h.name);
    setFormErr(null);
    const entry =
      h.config.kind === "stdio"
        ? { name: h.short, kind: "stdio", command: h.config.command, args: h.config.args }
        : { name: h.short, kind: h.config.kind, url: h.config.url };
    const r = await fetch("/api/mcp", { method: "POST", headers: headers(), body: JSON.stringify({ entry }) });
    const d = await r.json();
    if (!d.ok) setFormErr(t(errKey(d.error)));
    setAdding(null);
    await refresh();
  };

  const dotClass = (e: ConnEntry) =>
    !e.enabled ? "conn-dot-off" : e.status === "connected" ? "conn-dot-ok" : e.status === "failed" || e.status === "needs-auth" ? "conn-dot-err" : "conn-dot-pending";

  return (
    <section className="settings-section">
      <h3>🔌 {t("secConnections")}</h3>
      <p className="settings-sub">{t("connIntro")}</p>
      {locked && <p className="conn-locked-note">{t("connLockedNote")}</p>}

      {servers.length === 0 && <p className="settings-sub">{t("connEmpty")}</p>}
      {servers.map((e) => (
        <div key={e.id}>
          <div className="conn-row">
            <span className={`conn-dot ${dotClass(e)}`} />
            <b>{e.name}</b>
            <span className="conn-meta">
              {e.presetId && PRESET_DESC[e.presetId] ? t(PRESET_DESC[e.presetId]) : e.kind === "stdio" ? `${e.command ?? ""} ${(e.args ?? []).join(" ")}`.trim() : e.url}
            </span>
            <span className="panel-head-spacer" />
            <label className="toggle-row">
              <input type="checkbox" checked={e.enabled} onChange={() => void toggle(e)} />
            </label>
            <button className="link-btn" disabled={testing !== null} onClick={() => void test(e)}>
              {testing === e.id ? t("connTesting") : t("connTest")}
            </button>
            <button className="icon-btn icon-btn-sm" aria-label={t("connDeleteConfirm")} onClick={() => setConfirmDel(e.id)}>
              🗑
            </button>
          </div>
          {testResult?.id === e.id && (
            <p className={testResult.ok ? "hist-ok" : "red-warning"}>
              {testResult.ok
                ? `${t("connTestOk")}${testResult.toolCount ? ` — ${testResult.toolCount} ${t("connToolsCount")}` : ""}`
                : `${t("connTestFail")}${testResult.error ? ` — ${testResult.error}` : ""}`}
            </p>
          )}
          {e.statusError && testResult?.id !== e.id && <p className="settings-sub">{e.statusError}</p>}
          {confirmDel === e.id && (
            <div className="open-confirm">
              <p className="settings-sub">{t("connDeleteConfirm")}</p>
              <div className="row-actions">
                <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>
                  {t("deny")}
                </button>
                <button className="btn btn-danger" onClick={() => void remove(e.id)}>
                  {t("proceedRed")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="chip-row conn-presets">
        {presets.map((p) => {
          const added = servers.some((s) => s.presetId === p.id || s.name === p.name);
          return (
            <button
              key={p.id}
              className={`chip ${added ? "active" : ""}`}
              disabled={added}
              onClick={() => (p.requiresToken ? setTokenFor(tokenFor === p.id ? null : p.id) : void addPreset(p.id))}
            >
              {added ? "✓ " : "+ "}
              {p.name}
              {p.requiresToken ? " 🔑" : ""}
            </button>
          );
        })}
      </div>
      {tokenFor && (
        <div className="conn-form">
          <p className="settings-sub">
            {t("connNeedsToken")} — {t("connTokenHint")}
          </p>
          <div className="git-commit-box">
            <input className="field-input" type="password" value={tokenVal} placeholder={t("connTokenPh")} onChange={(e) => setTokenVal(e.target.value)} />
            <button className="btn btn-soft btn-sm" disabled={!tokenVal.trim()} onClick={() => void addPreset(tokenFor, tokenVal)}>
              {t("connSave")}
            </button>
          </div>
        </div>
      )}

      <div className="git-commit-box">
        <input
          className="field-input"
          value={mq}
          placeholder={t("connSearchPh")}
          spellCheck={false}
          onChange={(e) => setMq(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void searchMarket()}
        />
        <button className="btn btn-soft btn-sm" disabled={mktBusy || mq.trim().length < 2} onClick={() => void searchMarket()}>
          {mktBusy ? "…" : "🔍"}
        </button>
      </div>
      {mktBusy && <p className="settings-sub">{t("connMarketSlow")}</p>}
      {mkt !== null && !mktBusy && (
        <div className="conv-list market-list">
          {mkt.length === 0 && <p className="settings-sub">{t("connMarketEmpty")}</p>}
          {mkt.map((h) => {
            const already = servers.some((s) => s.name === h.short);
            return (
              <div key={h.name} className="conn-row">
                <b>{h.short}</b>
                <span className="conn-meta">{h.description}</span>
                <span className="panel-head-spacer" />
                <button
                  className="btn btn-soft btn-sm"
                  disabled={already || adding !== null}
                  onClick={() => void addFromMarket(h)}
                >
                  {already ? "✓" : adding === h.name ? "…" : `${t("connAdd")}${needsSetup(h) ? " 🔑" : ""}`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button className="link-btn" onClick={() => setShowForm((v) => !v)}>
        {showForm ? "▾" : "▸"} {t("connAddManual")}
      </button>
      {showForm && (
        <div className="conn-form">
          <label className="select-row">
            <span>{t("connName")}</span>
            <input className="field-input" value={fName} spellCheck={false} onChange={(e) => setFName(e.target.value)} />
          </label>
          <div className="chip-row">
            <button className={`chip ${fKind === "stdio" ? "active" : ""}`} onClick={() => setFKind("stdio")}>
              {t("connKindCmd")}
            </button>
            <button className={`chip ${fKind === "url" ? "active" : ""}`} onClick={() => setFKind("url")}>
              {t("connKindUrl")}
            </button>
          </div>
          {fKind === "stdio" ? (
            <>
              <label className="select-row">
                <span>{t("connCommand")}</span>
                <input className="field-input" value={fCommand} spellCheck={false} placeholder="npx" onChange={(e) => setFCommand(e.target.value)} />
              </label>
              <label className="select-row">
                <span>{t("connArgs")}</span>
                <textarea className="field-input" rows={3} value={fArgs} spellCheck={false} onChange={(e) => setFArgs(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="select-row">
                <span>{t("connUrl")}</span>
                <input className="field-input" value={fUrl} spellCheck={false} placeholder="https://" onChange={(e) => setFUrl(e.target.value)} />
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={fSse} onChange={(e) => setFSse(e.target.checked)} />
                <span>{t("connKindSseNote")}</span>
              </label>
            </>
          )}
          <p className="settings-sub">{fKind === "stdio" ? t("connEnvVars") : t("connHeaders")}</p>
          {fKv.map((row, i) => (
            <div key={i} className="kv-row">
              <input className="field-input" value={row.k} placeholder={t("connKeyPh")} spellCheck={false}
                onChange={(e) => setFKv((rows) => rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))} />
              <input className="field-input" type={SECRETISH.test(row.k) ? "password" : "text"} value={row.v} placeholder={t("connValuePh")} spellCheck={false}
                onChange={(e) => setFKv((rows) => rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))} />
              <button className="icon-btn icon-btn-sm" onClick={() => setFKv((rows) => rows.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button className="link-btn" onClick={() => setFKv((rows) => [...rows, { k: "", v: "" }])}>
            {t("connAddRow")}
          </button>
          {formErr && <p className="red-warning">{formErr}</p>}
          <div className="row-actions">
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>
              {t("deny")}
            </button>
            <button
              className="btn btn-primary"
              disabled={!fName.trim() || (fKind === "stdio" ? !fCommand.trim() : !fUrl.trim())}
              onClick={() => void submitManual()}
            >
              {t("connSave")}
            </button>
          </div>
        </div>
      )}
      {formErr && !showForm && <p className="red-warning">{formErr}</p>}
    </section>
  );
}
