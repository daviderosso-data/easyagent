"use client";

import { useEffect } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { Icon } from "@/components/icons";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable=true]");
}

/** App-wide keyboard shortcuts. Mounted once (page level).
 *  - Mod+1…9 switch between the visible chats
 *  - Mod+K opens the command palette of the active chat
 *  - ? opens the shortcut help, Esc leaves focus mode / closes the help */
export function useGlobalShortcuts(helpOpen: boolean, setHelpOpen: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useAgent.getState();

      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key >= "1" && e.key <= "9") {
        const visible = st.panels.filter((id) =>
          st.activeProject ? st.sessions[id]?.project === st.activeProject : true,
        );
        const target = visible[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          st.setActivePanel(target);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        st.requestPalette();
        return;
      }

      if (e.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else if (st.focusPanel) st.setFocusPanel("");
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
        e.preventDefault();
        setHelpOpen(!helpOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, setHelpOpen]);
}

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  const rows: { keys: string; label: string; plain?: boolean }[] = [
    { keys: `${MOD} + 1…9`, label: t("shortcutSwitch") },
    { keys: `${MOD} + K`, label: t("shortcutCommands") },
    { keys: "Enter", label: t("shortcutSend") },
    { keys: "Shift + Enter", label: t("shortcutNewline") },
    { keys: t("shortcutFocusKey"), label: t("shortcutFocus"), plain: true },
    { keys: "Esc", label: t("shortcutExitFocus") },
    { keys: "?", label: t("shortcutHelp") },
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts-modal" role="dialog" aria-modal="true" aria-label={t("shortcutsTitle")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head sc-head">
          <h2>{t("shortcutsTitle")}</h2>
          <button className="icon-btn icon-btn-sm" onClick={onClose} aria-label={t("close")}>
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="sc-list">
          {rows.map((r) => (
            <div key={r.label} className="sc-row">
              <span className="sc-keys">
                {r.plain ? (
                  <span className="sc-plain">{r.keys}</span>
                ) : (
                  r.keys.split(" + ").map((k, i) => (
                    <span key={i}>
                      {i > 0 && " + "}
                      <kbd className="kbd">{k}</kbd>
                    </span>
                  ))
                )}
              </span>
              <span className="sc-label">{r.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
