"use client";

import { useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { TEMPLATE_IDS, TEMPLATE_LABEL_KEY, type TemplateId } from "@/lib/templates";

interface ProjectInfo {
  folder: string;
  displayName: string;
  path: string;
  type: "manual" | "orchestrated";
  createdAt: number;
  lastOpenedAt: number;
}
interface SessionSummary {
  sessionId: string;
  firstPrompt: string;
  summary: string;
  lastModified: number;
}

export function ProjectsPanel({ panelId, onClose }: { panelId: string; onClose: () => void }) {
  const t = useT();
  const token = useAgent((s) => s.token);
  const openProjectNewChat = useAgent((s) => s.openProjectNewChat);
  const resumeSession = useAgent((s) => s.resumeSession);

  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [selected, setSelected] = useState<ProjectInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState<TemplateId>("empty");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const headers = (): Record<string, string> => ({ "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) });
  const load = () => fetch("/api/projects").then((r) => r.json()).then((d) => setProjects(d.projects || [])).catch(() => setProjects([]));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const n = newName.trim();
    if (!n) return;
    const d = await fetch("/api/projects", { method: "POST", headers: headers(), body: JSON.stringify({ name: n, template }) }).then((r) => r.json());
    setNewName("");
    setTemplate("empty");
    await load();
    if (d.ok && d.project) void selectProject(d.project);
  };
  const doRename = async (folder: string) => {
    const n = renameVal.trim();
    setRenaming(null);
    if (!n) return;
    await fetch("/api/projects", { method: "PATCH", headers: headers(), body: JSON.stringify({ folder, name: n }) });
    await load();
  };
  const doDelete = async (folder: string) => {
    await fetch("/api/projects", { method: "DELETE", headers: headers(), body: JSON.stringify({ folder }) });
    setConfirmDel(null);
    await load();
  };
  const selectProject = async (p: ProjectInfo) => {
    setSelected(p);
    setSessions(null);
    const d = await fetch(`/api/projects/sessions?dir=${encodeURIComponent(p.path)}`, { headers: token ? { "x-ccw-token": token } : {} })
      .then((r) => r.json())
      .catch(() => ({ sessions: [] }));
    setSessions(d.sessions || []);
  };

  // ----- Level 2: a project's conversation history -----
  if (selected) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="settings-modal">
          <div className="settings-head">
            <h2>📁 {selected.displayName}</h2>
            <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
              ✕
            </button>
          </div>
          <div className="settings-body">
            <button className="link-btn" onClick={() => { setSelected(null); setSessions(null); }}>
              ‹ {t("back")}
            </button>
            <button className="btn btn-primary full-btn" onClick={() => { openProjectNewChat(panelId, selected.path); onClose(); }}>
              ＋ {t("newChat")}
            </button>
            <h4 className="limits-title">{t("conversations")}</h4>
            {sessions === null ? (
              <p className="settings-sub">…</p>
            ) : sessions.length === 0 ? (
              <p className="settings-sub">{t("noConversations")}</p>
            ) : (
              <div className="conv-list">
                {sessions.map((s) => (
                  <button key={s.sessionId} className="conv-row" onClick={() => { void resumeSession(panelId, selected.path, s.sessionId); onClose(); }}>
                    <span className="conv-title">{s.firstPrompt || t("untitledChat")}</span>
                    <span className="conv-date">{new Date(s.lastModified).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ----- Level 1: project list -----
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal">
        <div className="settings-head">
          <h2>📂 {t("projects")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          <div className="fp-new">
            <input
              className="field-input"
              placeholder={t("newProjectName")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            />
            <button className="btn btn-primary btn-sm" disabled={!newName.trim()} onClick={() => void create()}>
              ＋ {t("create")}
            </button>
          </div>
          <div className="tpl-row">
            <span className="tpl-label">{t("template")}</span>
            {TEMPLATE_IDS.map((id) => (
              <button
                key={id}
                className={`tpl-chip ${template === id ? "tpl-chip-active" : ""}`}
                onClick={() => setTemplate(id)}
              >
                {t(TEMPLATE_LABEL_KEY[id])}
              </button>
            ))}
          </div>
          {projects === null ? (
            <p className="settings-sub">…</p>
          ) : projects.length === 0 ? (
            <p className="settings-sub">{t("pickProjectEmpty")}</p>
          ) : (
            <div className="proj-list">
              {projects.map((p) => (
                <div key={p.folder} className="proj-row">
                  {renaming === p.folder ? (
                    <input
                      className="field-input proj-rename"
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void doRename(p.folder); if (e.key === "Escape") setRenaming(null); }}
                      onBlur={() => void doRename(p.folder)}
                    />
                  ) : (
                    <button className="proj-main" onClick={() => void selectProject(p)}>
                      <span className="proj-name">{p.displayName}</span>
                      <span className={`proj-type proj-type-${p.type}`}>
                        {p.type === "orchestrated" ? t("typeOrchestrated") : t("typeManual")}
                      </span>
                    </button>
                  )}
                  <div className="proj-actions">
                    {confirmDel === p.folder ? (
                      <>
                        <button className="btn btn-danger btn-sm" onClick={() => void doDelete(p.folder)}>
                          {t("deletePermanently")}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>
                          {t("cancel")}
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="icon-btn icon-btn-sm" title={t("rename")} onClick={() => { setRenaming(p.folder); setRenameVal(p.displayName); }}>
                          ✎
                        </button>
                        <button className="icon-btn icon-btn-sm" title={t("deletePermanently")} onClick={() => setConfirmDel(p.folder)}>
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
