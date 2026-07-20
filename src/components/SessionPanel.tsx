"use client";

import { useEffect, useRef, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { MODELS, type Effort } from "@/lib/models";
import { Transcript } from "@/components/Transcript";
import { Composer } from "@/components/Composer";
import { ApprovalModal } from "@/components/ApprovalModal";
import { HistoryPanel } from "@/components/HistoryPanel";

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
  const previewState = useAgent((s) => s.sessions[id]?.previewState ?? "idle");
  const previewUrl = useAgent((s) => s.sessions[id]?.previewUrl ?? null);
  const startPreview = useAgent((s) => s.startPreview);
  const refreshPreview = useAgent((s) => s.refreshPreview);
  const [historyOpen, setHistoryOpen] = useState(false);
  const placeholderRef = useRef<Window | null>(null);

  const folderName = cwd ? cwd.split("/").filter(Boolean).pop() : "—";
  const rootRef = useRef<HTMLElement | null>(null);

  // With 5+ panels the grid scrolls — bring the activated panel into view.
  useEffect(() => {
    if (isActive && multi) rootRef.current?.scrollIntoView({ block: "nearest" });
  }, [isActive, multi]);

  // Resync preview state after reload/HMR (the server keeps it running).
  useEffect(() => {
    if (cwd) void refreshPreview(id);
  }, [cwd, id, refreshPreview]);

  // When a pending preview becomes ready, navigate the placeholder tab.
  useEffect(() => {
    const w = placeholderRef.current;
    if (!w || w.closed) return;
    if (previewState === "running" && previewUrl) {
      w.location.href = previewUrl;
      placeholderRef.current = null;
    } else if (previewState === "error" || previewState === "idle") {
      w.close();
      placeholderRef.current = null;
    }
  }, [previewState, previewUrl]);

  const onPreviewClick = () => {
    if (previewState === "running" && previewUrl) {
      window.open(previewUrl, "_blank");
      return;
    }
    // Open the tab synchronously (popup-blocker-safe), then start the server.
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<title>easyagent</title><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555">${t("previewPreparing")}</body>`);
      placeholderRef.current = w;
    }
    void startPreview(id);
  };

  return (
    <section ref={rootRef} className={`panel ${isActive && multi ? "panel-active" : ""}`} onMouseDown={() => setActive(id)}>
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
        <button className="icon-btn icon-btn-sm" disabled={!cwd} title={t("historyBtnTip")} aria-label={t("historyBtnTip")} onClick={() => setHistoryOpen(true)}>
          🕘
        </button>
        <button className="icon-btn icon-btn-sm" disabled={!cwd} title={t("previewTip")} aria-label={t("previewTip")} onClick={onPreviewClick}>
          ▶
        </button>
        {multi && (
          <button className="icon-btn icon-btn-sm" onClick={() => removePanel(id)} aria-label={t("close")}>
            ✕
          </button>
        )}
      </div>
      {previewState !== "idle" && <PreviewBar id={id} />}
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
      {historyOpen && <HistoryPanel id={id} onClose={() => setHistoryOpen(false)} />}
    </section>
  );
}

function PreviewBar({ id }: { id: string }) {
  const t = useT();
  const state = useAgent((s) => s.sessions[id]?.previewState ?? "idle");
  const url = useAgent((s) => s.sessions[id]?.previewUrl ?? null);
  const error = useAgent((s) => s.sessions[id]?.previewError);
  const log = useAgent((s) => s.sessions[id]?.previewLog);
  const refreshPreview = useAgent((s) => s.refreshPreview);
  const stopPreview = useAgent((s) => s.stopPreview);
  const [showLog, setShowLog] = useState(false);

  // Poll while the preview is coming up.
  useEffect(() => {
    if (state !== "installing" && state !== "starting") return;
    const h = setInterval(() => void refreshPreview(id), 1500);
    return () => clearInterval(h);
  }, [state, id, refreshPreview]);

  const label =
    state === "installing"
      ? t("previewInstalling")
      : state === "starting"
        ? t("previewPreparing")
        : state === "running"
          ? `${t("previewRunning")}${url ? ` — ${url.replace("http://", "")}` : ""}`
          : error === "none"
            ? t("previewNone")
            : t("previewFailed");

  return (
    <div className={`preview-bar ${state === "error" ? "preview-bar-err" : ""}`}>
      <span className="preview-bar-label">{label}</span>
      {state === "error" && (
        <button className="link-btn" onClick={() => setShowLog((v) => !v)}>
          {t("previewDetails")}
        </button>
      )}
      <span className="panel-head-spacer" />
      {state === "running" && url && (
        <button className="icon-btn icon-btn-sm" title={t("previewOpen")} aria-label={t("previewOpen")} onClick={() => window.open(url, "_blank")}>
          ↗
        </button>
      )}
      <button className="icon-btn icon-btn-sm" title={t("previewStop")} aria-label={t("previewStop")} onClick={() => void stopPreview(id)}>
        ■
      </button>
      {showLog && log && log.length > 0 && <pre className="preview-log preview-log-bar">{log.join("\n")}</pre>}
    </div>
  );
}
