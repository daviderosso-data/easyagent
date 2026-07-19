"use client";

import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { MODELS, type Effort } from "@/lib/models";
import { Transcript } from "@/components/Transcript";
import { Composer } from "@/components/Composer";
import { ApprovalModal } from "@/components/ApprovalModal";

const EFFORTS: { id: "" | Effort; key: "optDefault" | "effLow" | "effMedium" | "effHigh" | "effXhigh" | "effMax" }[] = [
  { id: "", key: "optDefault" },
  { id: "low", key: "effLow" },
  { id: "medium", key: "effMedium" },
  { id: "high", key: "effHigh" },
  { id: "xhigh", key: "effXhigh" },
  { id: "max", key: "effMax" },
];

export function SessionPanel({ id, onChangeFolder }: { id: string; onChangeFolder: (id: string) => void }) {
  const t = useT();
  const cwd = useAgent((s) => s.sessions[id]?.cwd ?? "");
  const roleLabel = useAgent((s) => s.sessions[id]?.roleLabel);
  const selModel = useAgent((s) => s.sessions[id]?.selModel ?? null);
  const effort = useAgent((s) => s.sessions[id]?.effort);
  const running = useAgent((s) => s.sessions[id]?.running ?? false);
  const isActive = useAgent((s) => s.activePanel === id);
  const multi = useAgent((s) => s.panels.length > 1);
  const setActive = useAgent((s) => s.setActivePanel);
  const removePanel = useAgent((s) => s.removePanel);
  const setModel = useAgent((s) => s.setModel);
  const setEffort = useAgent((s) => s.setEffort);

  const folderName = cwd ? cwd.split("/").filter(Boolean).pop() : "—";

  return (
    <section className={`panel ${isActive && multi ? "panel-active" : ""}`} onMouseDown={() => setActive(id)}>
      <div className="panel-head">
        {roleLabel && <span className="role-badge">{roleLabel}</span>}
        <button className="folder-btn folder-btn-sm" onClick={() => onChangeFolder(id)} title={cwd}>
          <span>📁</span>
          <span className="folder-btn-name">{folderName}</span>
        </button>

        <select
          className="hdr-select"
          value={selModel ?? ""}
          title={t("modelTip")}
          disabled={running}
          onChange={(e) => setModel(id, e.target.value || null)}
        >
          {MODELS.map((m) => (
            <option key={m.id ?? "default"} value={m.id ?? ""}>
              {m.id ? m.label : t("optDefault")}
            </option>
          ))}
        </select>

        <select
          className="hdr-select"
          value={effort ?? ""}
          title={t("effortTip")}
          disabled={running}
          onChange={(e) => setEffort(id, (e.target.value || undefined) as Effort | undefined)}
        >
          {EFFORTS.map((ef) => (
            <option key={ef.id || "default"} value={ef.id}>
              {t(ef.key)}
            </option>
          ))}
        </select>

        <span className="panel-head-spacer" />
        {multi && (
          <button className="icon-btn icon-btn-sm" onClick={() => removePanel(id)} aria-label={t("close")}>
            ✕
          </button>
        )}
      </div>
      <div className="panel-body">
        {cwd ? (
          <>
            <Transcript id={id} />
            <Composer id={id} />
          </>
        ) : (
          <div className="empty">
            <div className="empty-emoji">📁</div>
            <h2>{t("noProjectTitle")}</h2>
            <p>{t("noProjectBody")}</p>
            <button className="btn btn-primary" onClick={() => onChangeFolder(id)}>
              {t("noProjectAction")}
            </button>
          </div>
        )}
      </div>
      <ApprovalModal id={id} />
    </section>
  );
}
