"use client";

import { useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";

export function OrchestratorModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const runOrchestration = useAgent((s) => s.runOrchestration);
  const [goal, setGoal] = useState("");

  const start = () => {
    if (!goal.trim()) return;
    onClose();
    void runOrchestration(goal.trim()); // long-running; progress shows in the banner + panels
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal">
        <div className="settings-head">
          <h2>🧩 {t("orchestrateTitle")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          <p className="settings-sub">{t("orchestrateHint")}</p>
          <textarea
            className="composer-input orch-goal"
            rows={4}
            autoFocus
            placeholder={t("orchestrateGoal")}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              {t("close")}
            </button>
            <button className="btn btn-primary" disabled={!goal.trim()} onClick={start}>
              ▸ {t("startOrchestration")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
