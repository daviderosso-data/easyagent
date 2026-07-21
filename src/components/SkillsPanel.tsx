"use client";

import { useCallback, useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT, useLang } from "@/i18n";
import { apiReadFile } from "@/lib/fs-client";
import { clearCommandsCache } from "@/lib/commands-client";
import { Icon } from "@/components/icons";

interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  dir: string;
  file: string;
  command: string;
}

interface MarketHit {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

function fmtInstalls(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function generatorPrompt(desc: string, lang: "en" | "it"): string {
  const base = `Create a new reusable skill for this project.
What it must be able to do (user's words): """${desc}"""
1. Pick a short lowercase name (letters, digits, hyphens; e.g. "release-notes").
2. Create ONLY the file .claude/skills/<name>/SKILL.md with YAML frontmatter:
   ---
   name: <name>
   description: <one sentence: when this skill should be used>
   ---
   followed by a short markdown body with clear step-by-step instructions to follow when the skill is used.
3. Do not create other files. Do not rely on inline shell execution (it is disabled).`;
  return lang === "it"
    ? `${base}\nFinish with one short sentence IN ITALIAN: what the skill does and its name.`
    : `${base}\nFinish with one short sentence: what the skill does and its name.`;
}

export function SkillsPanel({ panelId, onClose }: { panelId: string; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const token = useAgent((s) => s.token);
  const cwd = useAgent((s) => s.sessions[panelId]?.cwd ?? "");
  const running = useAgent((s) => s.sessions[panelId]?.running ?? false);
  const send = useAgent((s) => s.send);

  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [detail, setDetail] = useState<SkillInfo | null>(null);
  const [body, setBody] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [desc, setDesc] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState(false);
  // skills.sh marketplace
  const [q, setQ] = useState("");
  const [market, setMarket] = useState<MarketHit[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installErr, setInstallErr] = useState<string | null>(null);

  const headers = useCallback(
    (): Record<string, string> => ({ "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) }),
    [token]
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`, { headers: headers() });
      const d = await r.json();
      if (d.ok) setSkills(d.skills);
      else setErr(true);
    } catch {
      setErr(true);
    }
  }, [cwd, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Debounced marketplace search (proxied server-side — skills.sh has no CORS).
  useEffect(() => {
    if (q.trim().length < 2) {
      setMarket(null);
      return;
    }
    const h = setTimeout(() => {
      fetch(`/api/skills/market?q=${encodeURIComponent(q.trim())}`, { headers: headers() })
        .then((r) => r.json())
        .then((d) => setMarket(d.ok ? d.skills : []))
        .catch(() => setMarket([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q, headers]);

  const install = async (hit: MarketHit) => {
    setInstalling(hit.id);
    setInstallErr(null);
    try {
      const r = await fetch("/api/skills/install", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ cwd, source: hit.source, skillId: hit.skillId }),
      });
      const d = await r.json();
      if (!d.ok) setInstallErr(hit.id);
      else {
        clearCommandsCache(cwd);
        await refresh();
      }
    } catch {
      setInstallErr(hit.id);
    }
    setInstalling(null);
  };

  const openDetail = async (s: SkillInfo) => {
    setDetail(s);
    setConfirmDel(false);
    setBody("");
    const d = await apiReadFile(s.file, token);
    setBody(d.ok ? (d.content ?? "") : "");
  };

  const toggle = async (s: SkillInfo) => {
    const dirName = s.dir.split("/").pop()!;
    await fetch("/api/skills/toggle", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ cwd, name: dirName, enabled: !s.enabled }),
    });
    clearCommandsCache(cwd);
    await refresh();
  };

  const doDelete = async () => {
    if (!detail) return;
    await fetch("/api/fs/delete", { method: "POST", headers: headers(), body: JSON.stringify({ path: detail.dir }) });
    clearCommandsCache(cwd);
    setDetail(null);
    await refresh();
  };

  const doCreate = () => {
    if (!desc.trim()) return;
    onClose();
    void send(panelId, generatorPrompt(desc.trim(), lang));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal">
        <div className="settings-head">
          <h2><Icon name="sparkles" size={16} /> {t("skillsTitle")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="settings-body">
          {creating ? (
            <div>
              <button className="link-btn" onClick={() => setCreating(false)}>
                ‹ {t("skillsTitle")}
              </button>
              <h3>{t("skillsNewTitle")}</h3>
              <textarea
                className="field-input skill-desc"
                rows={4}
                value={desc}
                placeholder={t("skillsDescPh")}
                onChange={(e) => setDesc(e.target.value)}
                autoFocus
              />
              <p className="settings-sub">{t("skillsCreating")}</p>
              <div className="row-actions">
                <button className="btn btn-ghost" onClick={() => setCreating(false)}>
                  {t("deny")}
                </button>
                <button className="btn btn-primary" disabled={!desc.trim() || running} onClick={doCreate}>
                  {t("skillsCreate")}
                </button>
              </div>
            </div>
          ) : detail ? (
            <div className="hist-detail">
              <button className="link-btn" onClick={() => setDetail(null)}>
                ‹ {t("skillsTitle")}
              </button>
              <h3>{detail.name}</h3>
              {detail.description && <p className="settings-sub">{detail.description}</p>}
              <p className="settings-sub">
                {t("skillsInvokeHint")} <code className="skill-cmd">/{detail.command}</code>
              </p>
              {body && <pre className="skill-md">{body}</pre>}
              {confirmDel ? (
                <div className="open-confirm">
                  <p className="settings-sub">{t("skillsDeleteConfirm")}</p>
                  <div className="row-actions">
                    <button className="btn btn-ghost" onClick={() => setConfirmDel(false)}>
                      {t("deny")}
                    </button>
                    <button className="btn btn-danger" onClick={() => void doDelete()}>
                      {t("proceedRed")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row-actions">
                  <button className="btn btn-ghost" onClick={() => setConfirmDel(true)}>
                    <Icon name="trash" size={13} /> {t("deleteAction")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="settings-sub">{t("skillsIntro")}</p>
              <input
                className="field-input"
                value={q}
                placeholder={t("skillsSearchPh")}
                spellCheck={false}
                onChange={(e) => setQ(e.target.value)}
              />
              {market !== null && (
                <div className="conv-list market-list">
                  {market.length === 0 && <p className="settings-sub">{t("skillsMarketEmpty")}</p>}
                  {market.map((h) => {
                    const already = skills?.some((s) => s.dir.split("/").pop() === h.skillId);
                    return (
                      <div key={h.id} className="conv-row skill-row">
                        <span className="conv-title">
                          {h.name}
                          <span className="hist-badge skill-badge">⬇ {fmtInstalls(h.installs)}</span>
                        </span>
                        <span className="conv-date">{h.source}</span>
                        {installErr === h.id && <span className="red-warning">{t("skillsInstallErr")}</span>}
                        <button
                          className="btn btn-soft btn-sm"
                          disabled={!cwd || installing !== null || already}
                          onClick={() => void install(h)}
                        >
                          {already ? "✓" : installing === h.id ? t("skillsInstalling") : t("skillsInstall")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {err && <p className="red-warning">{t("skillsLoadError")}</p>}
              {market === null && skills !== null && skills.length === 0 && <p className="settings-sub">{t("skillsEmpty")}</p>}
              {market === null && skills !== null && skills.length > 0 && (
                <div className="conv-list">
                  {skills.map((s) => (
                    <div key={s.dir} className="conv-row skill-row" onClick={() => void openDetail(s)}>
                      <span className="conv-title">
                        {s.name}
                        <span className={`hist-badge ${s.enabled ? "hist-badge-new" : "hist-badge-mod"} skill-badge`}>
                          {s.enabled ? t("skillsOn") : t("skillsOff")}
                        </span>
                      </span>
                      {s.description && <span className="conv-date">{s.description}</span>}
                      <label className="toggle-row skill-toggle" onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" checked={s.enabled} onChange={() => void toggle(s)} />
                      </label>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn btn-primary full-btn" disabled={!cwd} onClick={() => setCreating(true)}>
                <Icon name="plus" size={13} /> {t("skillsNew")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
