"use client";

import { useAgent, MAX_PANELS } from "@/store/agent";
import { useT } from "@/i18n";
import { colorHex } from "@/lib/panel-colors";
import { FileTree } from "@/components/FileTree";

export function Sidebar({
  onAddPanel,
  onOrchestrate,
  onProjects,
  onAnalytics,
  onSkills,
}: {
  onAddPanel: () => void;
  onOrchestrate: () => void;
  onProjects: () => void;
  onAnalytics: () => void;
  onSkills: () => void;
}) {
  const t = useT();
  const panels = useAgent((s) => s.panels);
  const sessions = useAgent((s) => s.sessions);
  const activePanel = useAgent((s) => s.activePanel);
  const setActive = useAgent((s) => s.setActivePanel);
  const openProjects = useAgent((s) => s.openProjects);
  const activeProject = useAgent((s) => s.activeProject);
  const activateProject = useAgent((s) => s.activateProject);
  const unpinProject = useAgent((s) => s.unpinProject);

  // Sessions of the project on screen (no pinned project → the empty first-run panel).
  const visible = panels.filter((pid) => (activeProject ? sessions[pid]?.project === activeProject : true));

  return (
    <aside className="sidebar">
      <button className="projects-btn" onClick={onProjects}>
        📂 {t("projects")}
      </button>

      {openProjects.length > 0 && (
        <div className="pinned-projects">
          {openProjects.map((p) => {
            const name = p.split("/").filter(Boolean).pop();
            const running = panels.some((pid) => sessions[pid]?.project === p && sessions[pid]?.running);
            return (
              <div
                key={p}
                role="button"
                tabIndex={0}
                className={`pin-row ${activeProject === p ? "active" : ""}`}
                onClick={() => activateProject(p)}
                onKeyDown={(e) => e.key === "Enter" && activateProject(p)}
                title={p}
              >
                <span className="pin-name">📁 {name}</span>
                {running && <span className="session-dot" />}
                <span
                  className="pin-close"
                  role="button"
                  aria-label={t("unpinTip")}
                  title={t("unpinTip")}
                  onClick={(e) => {
                    e.stopPropagation();
                    unpinProject(p);
                  }}
                >
                  ✕
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="sidebar-sessions">
        <div className="sidebar-head">
          <span>{t("sessions")}</span>
          <button
            className="icon-btn icon-btn-sm"
            disabled={visible.length >= MAX_PANELS}
            onClick={onAddPanel}
            title={t("newSession")}
            aria-label={t("newSession")}
          >
            ＋
          </button>
        </div>
        {visible.map((pid, i) => {
          const s = sessions[pid];
          const name = s?.roleLabel || (s?.cwd ? s.cwd.split("/").filter(Boolean).pop() : "—");
          return (
            <button
              key={pid}
              className={`session-row ${activePanel === pid ? "active" : ""}`}
              onClick={() => setActive(pid)}
            >
              <span
                className="session-num"
                style={colorHex(s?.color) ? { background: colorHex(s?.color)!, color: "#fff" } : undefined}
              >
                {i + 1}
              </span>
              <span className="session-name">{name}</span>
              {s?.running && <span className="session-dot" />}
            </button>
          );
        })}
        <button className="orch-btn" onClick={onOrchestrate}>
          🧩 {t("orchestrate")}
        </button>
        <button className="orch-btn" onClick={onAnalytics}>
          📊 {t("analytics")}
        </button>
        <button className="orch-btn" disabled={!sessions[activePanel]?.cwd} onClick={onSkills}>
          ✨ {t("skills")}
        </button>
      </div>
      <FileTree />
    </aside>
  );
}
