"use client";

import { useEffect, useState } from "react";
import { useAgent, MAX_PANELS } from "@/store/agent";
import { useT } from "@/i18n";
import { colorHex, PANEL_COLORS } from "@/lib/panel-colors";
import { FileTree } from "@/components/FileTree";
import { Icon } from "@/components/icons";

/** Drag payload key for moving a pinned project into a group (P6.11.4). */
const DND_PROJECT = "application/x-easyagent-project";

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
  // P6.11.4 — colored project folders (logical groups; nothing moves on disk).
  const groups = useAgent((s) => s.groups);
  const groupMap = useAgent((s) => s.projectGroupMap);
  const loadProjectsMeta = useAgent((s) => s.loadProjectsMeta);
  const assignProjectGroup = useAgent((s) => s.assignProjectGroup);
  const saveGroup = useAgent((s) => s.saveGroup);
  const renameGroup = useAgent((s) => s.renameGroup);
  const removeGroup = useAgent((s) => s.removeGroup);

  useEffect(() => {
    void loadProjectsMeta();
  }, [loadProjectsMeta]);

  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState<{ from: string; to: string } | null>(null);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);

  const toggleCollapsed = (name: string) =>
    setCollapsed((c) => (c.includes(name) ? c.filter((x) => x !== name) : [...c, name]));

  // Sessions of the project on screen (no pinned project → the empty first-run panel).
  const visible = panels.filter((pid) => (activeProject ? sessions[pid]?.project === activeProject : true));

  // P6.9.3 — every pending approval across ALL projects (background ones too).
  const inbox = panels.flatMap((pid) => {
    const s = sessions[pid];
    return (s?.pending ?? []).map((p) => ({
      pid,
      project: s?.project,
      name: s?.roleLabel || (s?.cwd ? s.cwd.split("/").filter(Boolean).pop() : "—"),
      title: p.title,
      risk: p.risk,
      approvalId: p.approvalId,
    }));
  });

  const jumpTo = (pid: string, project?: string) => {
    if (project && project !== activeProject) activateProject(project);
    setActive(pid);
  };

  const knownGroup = (p: string) => (groupMap[p] && groups.some((g) => g.name === groupMap[p]) ? groupMap[p] : null);
  const ungrouped = openProjects.filter((p) => !knownGroup(p));

  const pinRow = (p: string) => {
    const name = p.split("/").filter(Boolean).pop();
    const running = panels.some((pid) => sessions[pid]?.project === p && sessions[pid]?.running);
    return (
      <div
        key={p}
        role="button"
        tabIndex={0}
        className={`pin-row ${activeProject === p ? "active" : ""}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_PROJECT, p);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => activateProject(p)}
        onKeyDown={(e) => e.key === "Enter" && activateProject(p)}
        title={p}
      >
        <span className="pin-name"><Icon name="folder" size={12} /> {name}</span>
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
          <Icon name="x" size={11} />
        </span>
      </div>
    );
  };

  const dropProps = (target: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DND_PROJECT)) return;
      e.preventDefault();
      setDropGroup(target ?? "");
    },
    onDragLeave: () => setDropGroup(null),
    onDrop: (e: React.DragEvent) => {
      setDropGroup(null);
      const src = e.dataTransfer.getData(DND_PROJECT);
      if (!src) return;
      e.preventDefault();
      void assignProjectGroup(src, target);
    },
  });

  return (
    <aside className="sidebar">
      <button className="projects-btn" onClick={onProjects}>
        <Icon name="folderOpen" size={14} /> {t("projects")}
      </button>

      {inbox.length > 0 && (
        <div className="inbox" role="region" aria-label={t("inboxTitle")}>
          <div className="inbox-head">
            <Icon name="bell" size={13} /> {t("inboxTitle")}
            <span className="inbox-badge">{inbox.length}</span>
          </div>
          {inbox.map((a) => (
            <button key={a.approvalId} className="inbox-row" onClick={() => jumpTo(a.pid, a.project)}>
              <span className={`inbox-dot ${a.risk === "red" ? "inbox-dot-red" : ""}`} />
              <span className="inbox-text">
                <span className="inbox-session">{a.name}</span>
                <span className="inbox-title">{a.title}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {(openProjects.length > 0 || groups.length > 0) && (
        <div className="pinned-projects">
          {groups.map((g) => {
            const members = openProjects.filter((p) => knownGroup(p) === g.name);
            const isCollapsed = collapsed.includes(g.name);
            return (
              <div key={g.name}>
                <div
                  role="button"
                  tabIndex={0}
                  className={`group-head ${dropGroup === g.name ? "ft-drop" : ""}`}
                  onClick={() => toggleCollapsed(g.name)}
                  onKeyDown={(e) => e.key === "Enter" && toggleCollapsed(g.name)}
                  {...dropProps(g.name)}
                >
                  <span className="group-caret">{isCollapsed ? "▸" : "▾"}</span>
                  <span className="color-wrap">
                    <button
                      className="color-dot-btn group-dot"
                      title={t("groupColorTip")}
                      aria-label={t("groupColorTip")}
                      style={colorHex(g.color) ? { background: colorHex(g.color)! } : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setColorFor((v) => (v === g.name ? null : g.name));
                      }}
                    />
                    {colorFor === g.name && (
                      <span className="color-pop" onMouseLeave={() => setColorFor(null)}>
                        {PANEL_COLORS.map((c) => (
                          <button
                            key={c.id}
                            className={`color-swatch ${g.color === c.id ? "sel" : ""}`}
                            style={{ background: c.hex }}
                            aria-label={c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setColorFor(null);
                              void saveGroup(g.name, c.id);
                            }}
                          />
                        ))}
                      </span>
                    )}
                  </span>
                  {editGroup?.from === g.name ? (
                    <input
                      autoFocus
                      className="group-edit"
                      value={editGroup.to}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditGroup({ from: g.name, to: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const to = editGroup.to.trim();
                          if (to && to !== g.name) void renameGroup(g.name, to);
                          setEditGroup(null);
                        }
                        if (e.key === "Escape") setEditGroup(null);
                      }}
                      onBlur={() => setEditGroup(null)}
                    />
                  ) : (
                    <span
                      className="group-name"
                      title={t("groupRenameTip")}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditGroup({ from: g.name, to: g.name });
                      }}
                    >
                      {g.name}
                    </span>
                  )}
                  <span
                    className="pin-close"
                    role="button"
                    aria-label={t("groupDeleteTip")}
                    title={t("groupDeleteTip")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeGroup(g.name);
                    }}
                  >
                    <Icon name="x" size={11} />
                  </span>
                </div>
                {!isCollapsed && members.map(pinRow)}
              </div>
            );
          })}

          <div className={`group-ungrouped ${dropGroup === "" ? "ft-drop" : ""}`} {...dropProps(null)}>
            {ungrouped.map(pinRow)}
          </div>

          {newGroup === null ? (
            <button className="link-btn group-add" onClick={() => setNewGroup("")}>
              + {t("newFolder")}
            </button>
          ) : (
            <input
              autoFocus
              className="group-edit"
              value={newGroup}
              placeholder={t("newFolder")}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newGroup.trim()) {
                  void saveGroup(newGroup.trim());
                  setNewGroup(null);
                }
                if (e.key === "Escape") setNewGroup(null);
              }}
              onBlur={() => setNewGroup(null)}
            />
          )}
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
            <Icon name="plus" size={14} />
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
          <Icon name="network" size={14} /> {t("orchestrate")}
        </button>
        <button className="orch-btn" onClick={onAnalytics}>
          <Icon name="chart" size={14} /> {t("analytics")}
        </button>
        <button className="orch-btn" disabled={!sessions[activePanel]?.cwd} onClick={onSkills}>
          <Icon name="sparkles" size={14} /> {t("skills")}
        </button>
      </div>
      <FileTree />
    </aside>
  );
}
