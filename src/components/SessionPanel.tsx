"use client";

import { useEffect, useRef, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { MODELS, type Effort } from "@/lib/models";
import { PANEL_COLORS, colorHex } from "@/lib/panel-colors";
import { Transcript } from "@/components/Transcript";
import { Composer } from "@/components/Composer";
import { ApprovalModal } from "@/components/ApprovalModal";
import { HistoryPanel } from "@/components/HistoryPanel";
import { Icon } from "@/components/icons";

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
  const provider = useAgent((s) => s.sessions[id]?.provider ?? "claude");
  const providers = useAgent((s) => s.providers);
  const setProvider = useAgent((s) => s.setProvider);
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
  const color = useAgent((s) => s.sessions[id]?.color);
  const setPanelColor = useAgent((s) => s.setPanelColor);
  const viewMode = useAgent((s) => s.viewMode);
  const isFocused = useAgent((s) => s.focusPanel === id);
  const setFocusPanel = useAgent((s) => s.setFocusPanel);
  const pendingCount = useAgent((s) => s.sessions[id]?.pending.length ?? 0);
  const costUsd = useAgent((s) =>
    (s.sessions[id]?.items ?? []).reduce((sum, it) => (it.kind === "done" ? sum + it.costUsd : sum), 0),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const token = useAgent((s) => s.token);
  const lang = useAgent((s) => s.lang);
  const pushToast = useAgent((s) => s.pushToast);
  const bumpFsRefresh = useAgent((s) => s.bumpFsRefresh);

  // P6.9.1 — one-click undo: restore the newest save point (the state before
  // the last turn). The restore itself is undoable from the History panel.
  const doUndo = async () => {
    if (!cwd || running || undoBusy) return;
    setUndoBusy(true);
    const headers: Record<string, string> = { "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) };
    try {
      const r = await fetch(`/api/history?cwd=${encodeURIComponent(cwd)}`, { headers });
      const latest = r.ok ? (await r.json()).points?.[0] : null;
      if (!latest) {
        pushToast("undoNothing");
      } else {
        const res = await fetch("/api/history/restore", {
          method: "POST",
          headers,
          body: JSON.stringify({ cwd, hash: latest.hash, lang }),
        });
        const out = await res.json().catch(() => null);
        if (res.ok && out?.ok) {
          bumpFsRefresh();
          pushToast("undoDone");
        } else {
          pushToast("undoFailed");
        }
      }
    } catch {
      pushToast("undoFailed");
    }
    setUndoBusy(false);
  };
  const placeholderRef = useRef<Window | null>(null);

  const folderName = cwd ? cwd.split("/").filter(Boolean).pop() : "—";
  const rootRef = useRef<HTMLElement | null>(null);

  // Engine-specific selector data; before /api/providers loads (or if it
  // fails) fall back to the static Claude catalogue.
  const providerInfo = providers.find((p) => p.id === provider);
  const models = providerInfo?.models ?? MODELS;
  const effortSupported = providerInfo?.capabilities.effort ?? provider === "claude";
  const engineLabel = providerInfo?.label ?? (provider === "claude" ? "Claude" : provider);
  const modelLabel = selModel ? (models.find((m) => m.id === selModel)?.label ?? selModel) : t("optDefault");
  const canFocus = multi && viewMode === "split";
  const toggleFocus = () => canFocus && setFocusPanel(isFocused ? "" : id);

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

  const accent = colorHex(color);
  return (
    <section
      ref={rootRef}
      className={`panel ${isActive && multi ? "panel-active" : ""} ${accent ? "panel-colored" : ""}`}
      style={accent ? ({ "--panel-accent": accent } as React.CSSProperties) : undefined}
      onMouseDown={() => setActive(id)}
    >
      <div className="panel-head" onDoubleClick={toggleFocus}>
        <span className="color-wrap">
          <button
            className="color-dot-btn"
            title={t("panelColorTip")}
            aria-label={t("panelColorTip")}
            style={accent ? { background: accent } : undefined}
            onClick={() => setColorOpen((v) => !v)}
          />
          {colorOpen && (
            <span className="color-pop" onMouseLeave={() => setColorOpen(false)}>
              {PANEL_COLORS.map((c) => (
                <button
                  key={c.id}
                  className={`color-swatch ${color === c.id ? "sel" : ""}`}
                  style={{ background: c.hex }}
                  aria-label={c.id}
                  onClick={() => {
                    setPanelColor(id, c.id);
                    setColorOpen(false);
                  }}
                />
              ))}
              <button
                className="color-swatch color-none"
                aria-label="none"
                onClick={() => {
                  setPanelColor(id, undefined);
                  setColorOpen(false);
                }}
              >
                ∅
              </button>
            </span>
          )}
        </span>
        {roleLabel && <span className="role-badge" style={accent ? { background: accent, color: "#fff" } : undefined}>{roleLabel}</span>}
        <button className="folder-btn folder-btn-sm" onClick={() => onChangeFolder(id)} title={cwd}>
          <Icon name="folder" size={13} />
          <span className="folder-btn-name">{folderName}</span>
        </button>

        {providers.length > 1 && (
          <select
            className="hdr-select"
            value={provider}
            title={t("engineTip")}
            aria-label={t("engineTip")}
            disabled={running}
            onChange={(e) => setProvider(id, e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.status.installed}>
                {p.status.installed ? p.label : `${p.label} — ${t("notInstalled")}`}
              </option>
            ))}
          </select>
        )}

        {/* Model & reasoning live behind one button — defaults over config. */}
        <span className="color-wrap">
          <button
            className={`icon-btn icon-btn-sm ${selModel || effort ? "icon-btn-set" : ""}`}
            title={t("tuneTip")}
            aria-label={t("tuneTip")}
            aria-expanded={tuneOpen}
            onClick={() => setTuneOpen((v) => !v)}
          >
            <Icon name="sliders" size={13} />
          </button>
          {tuneOpen && (
            <div className="hdr-pop" onMouseLeave={() => setTuneOpen(false)}>
              <label className="field">
                <span className="field-label">{t("fieldModel")}</span>
                <select
                  className="hdr-select hdr-select-full"
                  value={selModel ?? ""}
                  disabled={running}
                  onChange={(e) => setModel(id, e.target.value || null)}
                >
                  {models.map((m) => (
                    <option key={m.id ?? "default"} value={m.id ?? ""}>
                      {m.id ? m.label : t("optDefault")}
                    </option>
                  ))}
                </select>
              </label>
              {effortSupported && (
                <label className="field">
                  <span className="field-label">{t("fieldEffort")}</span>
                  <select
                    className="hdr-select hdr-select-full"
                    value={effort ?? ""}
                    disabled={running}
                    onChange={(e) => setEffort(id, (e.target.value || undefined) as Effort | undefined)}
                  >
                    {EFFORTS.map((ef) => (
                      <option key={ef.id || "default"} value={ef.id}>
                        {t(ef.key)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </span>

        <span className="panel-head-spacer" />
        <button className="icon-btn icon-btn-sm" disabled={!cwd || running || undoBusy} title={t("undoTurnTip")} aria-label={t("undoTurnTip")} onClick={() => void doUndo()}>
          <Icon name="undo" size={13} />
        </button>
        <button className="icon-btn icon-btn-sm" disabled={!cwd} title={t("historyBtnTip")} aria-label={t("historyBtnTip")} onClick={() => setHistoryOpen(true)}>
          <Icon name="clock" size={14} />
        </button>
        <button className="icon-btn icon-btn-sm" disabled={!cwd} title={t("previewTip")} aria-label={t("previewTip")} onClick={onPreviewClick}>
          <Icon name="play" size={13} />
        </button>
        {canFocus && (
          <button
            className="icon-btn icon-btn-sm"
            title={isFocused ? t("exitFocusTip") : t("focusTip")}
            aria-label={isFocused ? t("exitFocusTip") : t("focusTip")}
            onClick={toggleFocus}
          >
            <Icon name={isFocused ? "collapse" : "expand"} size={13} />
          </button>
        )}
        {multi && (
          <button className="icon-btn icon-btn-sm" onClick={() => removePanel(id)} aria-label={t("close")}>
            <Icon name="x" size={13} />
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
            <div className="empty-emoji"><Icon name="folder" size={36} /></div>
            <h2>{t("noProjectTitle")}</h2>
            <p>{t("noProjectBody")}</p>
            <button className="btn btn-primary" onClick={() => onChangeFolder(id)}>
              {t("noProjectAction")}
            </button>
          </div>
        )}
      </div>
      {cwd && (
        <div className="panel-status">
          <span className={`status-dot ${running ? "status-run" : pendingCount ? "status-wait" : "status-idle"}`} />
          <span>{running ? t("working") : pendingCount ? t("needsOk") : t("ready")}</span>
          <span className="panel-status-sep">·</span>
          <span>{engineLabel}</span>
          <span className="panel-status-sep">·</span>
          <span>{modelLabel}</span>
          {costUsd > 0 && (
            <>
              <span className="panel-status-sep">·</span>
              <span title={t("estimated")}>~${costUsd.toFixed(2)}</span>
            </>
          )}
        </div>
      )}
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
