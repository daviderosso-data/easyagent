"use client";

import { useAgent } from "@/store/agent";
import { colorHex } from "@/lib/panel-colors";
import { SessionPanel } from "@/components/SessionPanel";

export function PanelsGrid({ onChangeFolder }: { onChangeFolder: (id: string) => void }) {
  const panels = useAgent((s) => s.panels);
  const sessions = useAgent((s) => s.sessions);
  const activeProject = useAgent((s) => s.activeProject);
  const activePanel = useAgent((s) => s.activePanel);
  const setActive = useAgent((s) => s.setActivePanel);
  const viewMode = useAgent((s) => s.viewMode);

  // Only the active pinned project's sessions are on screen; the others keep
  // running in the background (their store state updates regardless).
  const visible = panels.filter((id) => (activeProject ? sessions[id]?.project === activeProject : true));

  if (viewMode === "tabs") {
    const current = visible.includes(activePanel) ? activePanel : visible[0];
    return (
      <div className="panels-tabs">
        <div className="panels-tabbar">
          {visible.map((id) => {
            const s = sessions[id];
            const name = s?.roleLabel || (s?.cwd ? s.cwd.split("/").filter(Boolean).pop() : "—");
            const hex = colorHex(s?.color);
            return (
              <button
                key={id}
                className={`panel-tab ${id === current ? "active" : ""}`}
                style={hex && id === current ? { borderTopColor: hex } : undefined}
                onClick={() => setActive(id)}
              >
                {hex && <span className="tab-color" style={{ background: hex }} />}
                <span className="panel-tab-name">{name}</span>
                {s?.running && <span className="session-dot" />}
              </button>
            );
          })}
        </div>
        <div className="panels-grid panels-1">
          {current && <SessionPanel key={current} id={current} onChangeFolder={onChangeFolder} />}
        </div>
      </div>
    );
  }

  // 1-4 panels: fixed layouts filling the viewport. 5+: two columns with a
  // minimum row height and vertical scrolling, so panels stay readable.
  const layout = visible.length <= 4 ? `panels-${visible.length}` : "panels-many";
  return (
    <div className={`panels-grid ${layout}`}>
      {visible.map((id) => (
        <SessionPanel key={id} id={id} onChangeFolder={onChangeFolder} />
      ))}
    </div>
  );
}
