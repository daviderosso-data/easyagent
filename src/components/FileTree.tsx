"use client";

import { useEffect, useRef, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { apiListDir, apiReadFile, apiRevealFolder, type Entry } from "@/lib/fs-client";

export function FileTree() {
  const cwd = useAgent((s) => s.sessions[s.activePanel]?.cwd ?? "");
  const token = useAgent((s) => s.token);
  const running = useAgent((s) => s.sessions[s.activePanel]?.running ?? false);
  const t = useT();
  const [root, setRoot] = useState<Entry[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewer, setViewer] = useState<{ name: string; content: string; tooBig: boolean } | null>(null);
  const prevRunning = useRef(running);

  useEffect(() => {
    if (!cwd) return;
    apiListDir(cwd, token).then((d) => setRoot(d.ok ? d.entries ?? [] : []));
  }, [cwd, token, reloadKey]);

  // Refresh the tree when a turn finishes (files may have changed).
  useEffect(() => {
    if (prevRunning.current && !running) setReloadKey((k) => k + 1);
    prevRunning.current = running;
  }, [running]);

  const openFile = async (path: string) => {
    const d = await apiReadFile(path, token);
    if (d.ok) setViewer({ name: d.name ?? "", content: d.content ?? "", tooBig: !!d.tooBig });
  };

  return (
    <aside className="filetree">
      <div className="filetree-head">
        <button
          className="ft-open"
          onClick={() => cwd && void apiRevealFolder(cwd, token)}
          title={t("openFolderTip")}
          disabled={!cwd}
        >
          📂 {t("files")} ↗
        </button>
        <button className="ft-refresh" onClick={() => setReloadKey((k) => k + 1)} aria-label="refresh">
          ↻
        </button>
      </div>
      <div className="filetree-body">
        {root === null ? (
          <div className="ft-empty">…</div>
        ) : root.length === 0 ? (
          <div className="ft-empty">{t("emptyFolder")}</div>
        ) : (
          root.map((e) => <TreeNode key={e.path} entry={e} depth={0} token={token} onOpenFile={openFile} />)
        )}
      </div>
      {viewer && (
        <FileViewer
          name={viewer.name}
          content={viewer.content}
          tooBig={viewer.tooBig}
          tooBigMsg={t("fileTooBig")}
          onClose={() => setViewer(null)}
        />
      )}
    </aside>
  );
}

function TreeNode({
  entry,
  depth,
  token,
  onOpenFile,
}: {
  entry: Entry;
  depth: number;
  token: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);

  const toggle = async () => {
    if (!entry.isDir) {
      onOpenFile(entry.path);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      const d = await apiListDir(entry.path, token);
      setChildren(d.ok ? d.entries ?? [] : []);
    }
  };

  return (
    <div>
      <button className="ft-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={toggle} title={entry.name}>
        <span className="ft-icon">{entry.isDir ? (open ? "📂" : "📁") : "📄"}</span>
        <span className="ft-name">{entry.name}</span>
      </button>
      {entry.isDir &&
        open &&
        children &&
        children.map((c) => <TreeNode key={c.path} entry={c} depth={depth + 1} token={token} onOpenFile={onOpenFile} />)}
    </div>
  );
}

function FileViewer({
  name,
  content,
  tooBig,
  tooBigMsg,
  onClose,
}: {
  name: string;
  content: string;
  tooBig: boolean;
  tooBigMsg: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="file-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="fv-head">
          <span className="fv-name">{name}</span>
          <button className="icon-btn" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <pre className="fv-body">{tooBig ? tooBigMsg : content}</pre>
      </div>
    </div>
  );
}
