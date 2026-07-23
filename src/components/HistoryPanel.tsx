"use client";

import { useCallback, useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT, useLang } from "@/i18n";
import { DiffText } from "@/components/DiffView";
import { Icon } from "@/components/icons";
import { sessionToHtml, sessionToMarkdown } from "@/lib/export-session";

interface SavePoint {
  hash: string;
  ts: number;
  label: string;
}

interface DiffFile {
  path: string;
  status: "modified" | "added" | "deleted";
  old: string;
  new: string;
  tooBig?: boolean;
  binary?: boolean;
}

interface GitViewFile {
  path: string;
  status: "modified" | "new" | "deleted" | "renamed";
}

interface GitStatus {
  ok: boolean;
  gitMissing?: boolean;
  hasRepo: boolean;
  branch?: string;
  hasRemote?: boolean;
  files: GitViewFile[];
}

export function HistoryPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const token = useAgent((s) => s.token);
  const cwd = useAgent((s) => s.sessions[id]?.cwd ?? "");
  const running = useAgent((s) => s.sessions[id]?.running ?? false);
  const bumpFsRefresh = useAgent((s) => s.bumpFsRefresh);
  const items = useAgent((s) => s.sessions[id]?.items ?? []);
  const provider = useAgent((s) => s.sessions[id]?.provider ?? "claude");
  const selModel = useAgent((s) => s.sessions[id]?.selModel ?? null);
  const providers = useAgent((s) => s.providers);

  // P6.9.7 — download the transcript as a self-contained document.
  const doExport = (fmt: "md" | "html") => {
    const folder = cwd.split("/").filter(Boolean).pop() ?? "session";
    const meta = {
      project: folder,
      engine: providers.find((p) => p.id === provider)?.label ?? provider,
      model: selModel ?? t("optDefault"),
      date: new Date().toLocaleString(),
      labels: { you: t("expYou"), assistant: t("expAssistant"), tool: t("expTool"), cost: t("expCost") },
    };
    const content = fmt === "md" ? sessionToMarkdown(items, meta) : sessionToHtml(items, meta);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: fmt === "md" ? "text/markdown" : "text/html" }));
    a.download = `${folder}-${stamp}.${fmt}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const [points, setPoints] = useState<SavePoint[] | null>(null);
  const [gitMissing, setGitMissing] = useState(false);
  const [detail, setDetail] = useState<SavePoint | null>(null);
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"done" | "failed" | null>(null);
  const [showGit, setShowGit] = useState(false);

  const headers = useCallback(
    (): Record<string, string> => ({ "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) }),
    [token]
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/history?cwd=${encodeURIComponent(cwd)}`, { headers: headers() });
      if (!r.ok) return;
      const data = await r.json();
      setPoints(data.points ?? []);
      setGitMissing(!!data.gitMissing);
    } catch {
      /* ignore */
    }
  }, [cwd, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDetail = (p: SavePoint) => {
    setDetail(p);
    setFiles(null);
    setOpenFile(null);
    setConfirming(false);
    setNotice(null);
  };

  const loadDiff = async () => {
    if (!detail) return;
    try {
      const r = await fetch(`/api/history/diff?cwd=${encodeURIComponent(cwd)}&hash=${detail.hash}`, { headers: headers() });
      const data = await r.json();
      setFiles(data.ok ? data.files : []);
    } catch {
      setFiles([]);
    }
  };

  const doRestore = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch("/api/history/restore", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ cwd, hash: detail.hash, lang }),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        setNotice("done");
        setConfirming(false);
        bumpFsRefresh();
        await refresh();
      } else {
        setNotice("failed");
      }
    } catch {
      setNotice("failed");
    }
    setBusy(false);
  };

  const badge = (s: DiffFile["status"]) =>
    s === "added" ? { cls: "hist-badge-new", label: t("fileNew") } : s === "deleted" ? { cls: "hist-badge-del", label: t("fileDeleted") } : { cls: "hist-badge-mod", label: t("fileChanged") };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="settings-modal">
        <div className="settings-head">
          <h2><Icon name="clock" size={16} /> {t("historyTitle")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="settings-body">
          {detail ? (
            <div className="hist-detail">
              <button className="link-btn" onClick={() => setDetail(null)}>
                ‹ {t("historyTitle")}
              </button>
              <h3>{detail.label}</h3>
              <p className="settings-sub">{new Date(detail.ts).toLocaleString()}</p>

              {notice === "done" && <p className="hist-ok">{t("goBackDone")}</p>}
              {notice === "failed" && <p className="red-warning">{t("goBackFailed")}</p>}

              {files === null ? (
                <button className="btn btn-soft btn-sm" onClick={loadDiff}>
                  {t("seeChanges")}
                </button>
              ) : files.length === 0 ? (
                <p className="settings-sub">{t("noChangesSince")}</p>
              ) : (
                <div>
                  {files.map((f) => {
                    const b = badge(f.status);
                    return (
                      <div key={f.path} className="hist-diff-file">
                        <button className="hist-file-row" onClick={() => setOpenFile(openFile === f.path ? null : f.path)}>
                          <span className={`hist-badge ${b.cls}`}>{b.label}</span>
                          <span className="hist-file-path">{f.path}</span>
                        </button>
                        {openFile === f.path && !f.tooBig && !f.binary && (
                          <DiffText oldText={f.old} newText={f.new} compact />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {running ? (
                <p className="settings-sub">{t("historyRunningNote")}</p>
              ) : confirming ? (
                <div className="open-confirm">
                  <p className="settings-sub">{t("goBackConfirmBody")}</p>
                  <div className="row-actions">
                    <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                      {t("deny")}
                    </button>
                    <button className="btn btn-primary" disabled={busy} onClick={doRestore}>
                      {t("goBackYes")}
                    </button>
                  </div>
                </div>
              ) : (
                notice !== "done" && (
                  <div className="row-actions">
                    <button className="btn btn-primary" onClick={() => setConfirming(true)}>
                      {t("goBack")}
                    </button>
                  </div>
                )
              )}
            </div>
          ) : (
            <>
              <p className="settings-sub">{t("historyIntro")}</p>
              {gitMissing ? (
                <p className="settings-sub">{t("historyGitMissing")}</p>
              ) : points === null ? null : points.length === 0 ? (
                <p className="settings-sub">{t("historyEmpty")}</p>
              ) : (
                <div className="conv-list">
                  {points.map((p) => (
                    <button key={p.hash} className="conv-row" onClick={() => openDetail(p)}>
                      <span className="conv-title">{p.label}</span>
                      <span className="conv-date">{new Date(p.ts).toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="export-row">
                <span className="settings-sub">{t("exportTitle")}</span>
                <button className="btn btn-soft btn-sm" disabled={!items.length} onClick={() => doExport("md")}>
                  Markdown
                </button>
                <button className="btn btn-soft btn-sm" disabled={!items.length} onClick={() => doExport("html")}>
                  HTML
                </button>
              </div>

              {!gitMissing && (
                <>
                  <button className="link-btn" onClick={() => setShowGit((v) => !v)}>
                    {showGit ? "▾" : "▸"} {t("advancedGit")}
                  </button>
                  {showGit && <GitSection cwd={cwd} headers={headers} />}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GitSection({ cwd, headers }: { cwd: string; headers: () => Record<string, string> }) {
  const t = useT();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pushTail, setPushTail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/git?cwd=${encodeURIComponent(cwd)}`, { headers: headers() });
      if (r.ok) setStatus(await r.json());
    } catch {
      /* ignore */
    }
  }, [cwd, headers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = async (path: string, body: object, doneNote: string) => {
    setBusy(path);
    setNote(null);
    setPushTail(null);
    try {
      const r = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      const data = await r.json();
      if (data.ok) {
        setNote(doneNote);
        if (path.endsWith("/commit")) setMessage("");
      } else {
        setNote(path.endsWith("/push") ? t("gitPushFailed") : t("goBackFailed"));
        if (data.errorTail) setPushTail(data.errorTail);
      }
    } catch {
      setNote(t("goBackFailed"));
    }
    setBusy(null);
    await refresh();
  };

  if (!status) return null;
  if (!status.hasRepo) {
    return (
      <div className="advanced">
        <p className="settings-sub">{t("gitNoRepo")}</p>
        <button className="btn btn-soft btn-sm" disabled={!!busy} onClick={() => post("/api/git/init", { cwd }, t("gitCommitDone"))}>
          {t("gitEnable")}
        </button>
      </div>
    );
  }

  const gitBadge = (s: GitViewFile["status"]) =>
    s === "new" ? "hist-badge-new" : s === "deleted" ? "hist-badge-del" : "hist-badge-mod";

  return (
    <div className="advanced">
      <p className="settings-sub">
        {t("gitBranch")}: <b>{status.branch || "—"}</b>
      </p>
      {status.files.length === 0 ? (
        <p className="settings-sub">{t("gitClean")}</p>
      ) : (
        <>
          <p className="settings-sub">{t("gitChangedFiles")}</p>
          {status.files.map((f) => (
            <div key={f.path} className="git-file-row">
              <span className={`hist-badge ${gitBadge(f.status)}`}>{f.status}</span>
              <span className="hist-file-path">{f.path}</span>
            </div>
          ))}
          <div className="git-commit-box">
            <input
              className="field-input"
              value={message}
              placeholder={t("gitCommitMsg")}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              className="btn btn-soft btn-sm"
              disabled={!message.trim() || !!busy}
              onClick={() => post("/api/git/commit", { cwd, message: message.trim() }, t("gitCommitDone"))}
            >
              {t("gitCommit")}
            </button>
          </div>
        </>
      )}
      {status.hasRemote && (
        <div className="row-actions">
          <button className="btn btn-soft btn-sm" disabled={!!busy} onClick={() => post("/api/git/push", { cwd }, t("gitPushDone"))}>
            {t("gitPush")}
          </button>
        </div>
      )}
      {note && <p className="settings-sub">{note}</p>}
      {pushTail && <pre className="preview-log">{pushTail}</pre>}
    </div>
  );
}
