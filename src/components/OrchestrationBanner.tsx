"use client";

import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";

export function OrchestrationBanner() {
  const orch = useAgent((s) => s.orch);
  const dismiss = useAgent((s) => s.dismissOrchestration);
  const t = useT();

  if (orch.phase === "idle") return null;

  const phaseText =
    orch.phase === "planning"
      ? t("orchPlanning")
      : orch.phase === "working"
        ? t("orchWorking")
        : orch.phase === "reviewing"
          ? t("orchReviewing")
          : orch.phase === "done"
            ? t("orchDone")
            : orch.error;

  const busy = orch.phase !== "done" && orch.phase !== "error";
  const closable = orch.phase === "done" || orch.phase === "error";

  return (
    <div className={`orch-banner orch-${orch.phase}`}>
      <div className="orch-banner-row">
        {busy && <span className="orch-spinner">◐</span>}
        <span className="orch-banner-title">
          🧩 {orch.projectName || t("orchestrate")} — {phaseText}
          {busy && orch.round > 1 ? ` · round ${orch.round}` : ""}
        </span>
        {closable && (
          <button className="icon-btn icon-btn-sm orch-close" onClick={dismiss} aria-label={t("close")}>
            ✕
          </button>
        )}
      </div>
      {orch.phase === "done" && orch.runInstructions && (
        <details className="orch-run" open>
          <summary>▶ {t("howToRun")}</summary>
          <pre>{orch.runInstructions}</pre>
        </details>
      )}
    </div>
  );
}
