"use client";

import { useCallback, useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT, useLang } from "@/i18n";
import { apiReadFile } from "@/lib/fs-client";
import { clearCommandsCache } from "@/lib/commands-client";

interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  dir: string;
  file: string;
  command: string;
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
          <h2>✨ {t("skillsTitle")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            ✕
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
                    🗑 {t("deleteAction")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="settings-sub">{t("skillsIntro")}</p>
              {err && <p className="red-warning">{t("skillsLoadError")}</p>}
              {skills !== null && skills.length === 0 && <p className="settings-sub">{t("skillsEmpty")}</p>}
              {skills !== null && skills.length > 0 && (
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
                ＋ {t("skillsNew")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
