"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import {
  apiListDir,
  apiReadFile,
  apiRevealFolder,
  apiMkdir,
  apiNewFile,
  apiWriteFile,
  apiRename,
  apiDelete,
  apiSearch,
  type Entry,
  type SearchHit,
} from "@/lib/fs-client";
import { CodeEditor } from "@/components/CodeEditor";
import { Icon } from "@/components/icons";

interface Tab {
  path: string;
  name: string;
  content: string;
  saved: string;
  binary: boolean;
  tooBig: boolean;
  /** Rendered by the image viewer instead of the editor (P6.9.9). */
  image?: boolean;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

type MenuKind = "newFile" | "newFolder" | "rename";

export function FileTree() {
  // The tree follows the active pinned project (panel cwds may be subfolders).
  const cwd = useAgent((s) => s.activeProject || s.sessions[s.activePanel]?.cwd || "");
  const token = useAgent((s) => s.token);
  const running = useAgent((s) => s.sessions[s.activePanel]?.running ?? false);
  const t = useT();
  const [root, setRoot] = useState<Entry[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  const [prompt, setPrompt] = useState<{ kind: MenuKind; target: Entry } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const prevRunning = useRef(running);

  const bump = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!cwd) {
      // No pinned project on screen → nothing to show (and nothing stale).
      setRoot(null);
      setQuery("");
      setHits(null);
      return;
    }
    apiListDir(cwd, token).then((d) => setRoot(d.ok ? d.entries ?? [] : []));
  }, [cwd, token, reloadKey]);

  // Open editor tabs belong to a project: when the project on screen changes
  // (or closes), tabs pointing outside it go away.
  useEffect(() => {
    setTabs((cur) => {
      const kept = cwd ? cur.filter((tab) => tab.path.startsWith(cwd + "/")) : [];
      return kept.length === cur.length ? cur : kept;
    });
    setActivePath((p) => (p && cwd && p.startsWith(cwd + "/") ? p : null));
  }, [cwd]);

  // Refresh the tree when a turn finishes (files may have changed).
  useEffect(() => {
    if (prevRunning.current && !running) bump();
    prevRunning.current = running;
  }, [running, bump]);

  // After a save-point restore, disk is the truth: refresh the tree AND
  // reload every open tab (a tab whose file vanished closes). The prev-value
  // guard makes the extra runs caused by the tabs dependency no-ops.
  const fsRefresh = useAgent((s) => s.fsRefresh);
  const prevFsRefresh = useRef(fsRefresh);
  useEffect(() => {
    if (fsRefresh === prevFsRefresh.current) return;
    prevFsRefresh.current = fsRefresh;
    bump();
    void (async () => {
      const reloaded = await Promise.all(
        tabs.map(async (tab) => {
          const d = await apiReadFile(tab.path, token);
          return d.ok ? { ...tab, content: d.content ?? "", saved: d.content ?? "", binary: !!d.binary, tooBig: !!d.tooBig } : null;
        })
      );
      const kept = reloaded.filter((x): x is Tab => x !== null);
      setTabs(kept);
      setActivePath((p) => (p && kept.some((t) => t.path === p) ? p : kept.length ? kept[kept.length - 1].path : null));
    })();
  }, [fsRefresh, bump, token, tabs]);

  // Debounced project search.
  useEffect(() => {
    if (!cwd || query.trim().length < 2) {
      setHits(null);
      return;
    }
    const h = setTimeout(() => {
      apiSearch(cwd, query.trim(), token).then((r) => setHits(r.ok ? r.hits ?? [] : []));
    }, 250);
    return () => clearTimeout(h);
  }, [query, cwd, token]);

  const openFile = async (path: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActivePath(path);
      return;
    }
    if (IMAGE_EXT_RE.test(path)) {
      const name = path.split("/").pop() ?? "";
      setTabs((ts) => [...ts, { path, name, content: "", saved: "", binary: true, tooBig: false, image: true }]);
      setActivePath(path);
      return;
    }
    const d = await apiReadFile(path, token);
    if (!d.ok) return;
    const tab: Tab = {
      path,
      name: d.name ?? path.split("/").pop() ?? "",
      content: d.content ?? "",
      saved: d.content ?? "",
      binary: !!d.binary,
      tooBig: !!d.tooBig,
    };
    setTabs((ts) => [...ts, tab]);
    setActivePath(path);
  };

  const setTabContent = (path: string, content: string) =>
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, content } : t)));

  const saveTab = async (path: string) => {
    const tab = tabs.find((t) => t.path === path);
    if (!tab || tab.binary || tab.tooBig) return;
    const r = await apiWriteFile(path, tab.content, token);
    if (r.ok) {
      setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, saved: t.content } : t)));
      bump();
    }
  };

  const closeTab = (path: string) => {
    setTabs((ts) => {
      const next = ts.filter((t) => t.path !== path);
      if (activePath === path) setActivePath(next.length ? next[next.length - 1].path : null);
      return next;
    });
  };

  const runPrompt = async (name: string) => {
    if (!prompt) return;
    const { kind, target } = prompt;
    const parentDir = target.isDir ? target.path : cwd;
    if (kind === "newFile") await apiNewFile(parentDir, name, token);
    else if (kind === "newFolder") await apiMkdir(parentDir, name, token);
    else if (kind === "rename") {
      const r = await apiRename(target.path, name, token);
      if (r.ok && r.path) {
        // If the renamed file is open, update/close its tab.
        setTabs((ts) => ts.filter((t) => t.path !== target.path));
        if (activePath === target.path) setActivePath(null);
      }
    }
    setPrompt(null);
    bump();
  };

  const del = async (entry: Entry) => {
    if (!window.confirm(t("deleteConfirm").replace("{name}", entry.name))) return;
    await apiDelete(entry.path, token);
    setTabs((ts) => ts.filter((t) => t.path !== entry.path));
    if (activePath === entry.path) setActivePath(null);
    bump();
  };

  const active = tabs.find((t) => t.path === activePath) ?? null;

  // Arrow keys walk the visible rows (Enter/Space already activate the row).
  const treeRef = useRef<HTMLDivElement>(null);
  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(treeRef.current?.querySelectorAll<HTMLButtonElement>(".ft-row") ?? []);
    if (!rows.length) return;
    const idx = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
    rows[next]?.focus();
    e.preventDefault();
  };

  return (
    <aside className="filetree" onClick={() => menu && setMenu(null)}>
      <div className="filetree-head">
        <button
          className="ft-open"
          onClick={() => cwd && void apiRevealFolder(cwd, token)}
          title={t("openFolderTip")}
          disabled={!cwd}
        >
          <Icon name="folderOpen" size={13} /> {t("files")} <Icon name="external" size={11} />
        </button>
        <button
          className="ft-refresh"
          onClick={() => cwd && setPrompt({ kind: "newFile", target: { name: "", path: cwd, isDir: true } })}
          title={t("newFile")}
          disabled={!cwd}
        >
          <Icon name="plus" size={14} />
        </button>
        <button className="ft-refresh" onClick={bump} aria-label="refresh">
          <Icon name="refresh" size={13} />
        </button>
      </div>

      <div className="ft-search">
        <input
          className="ft-search-input"
          value={query}
          placeholder={t("searchPlaceholder")}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!cwd}
        />
        {query && (
          <button className="ft-search-clear" onClick={() => setQuery("")} aria-label={t("cancel")}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <div className="filetree-body" ref={treeRef} onKeyDown={onTreeKeyDown}>
        {hits !== null ? (
          hits.length === 0 ? (
            <div className="ft-empty">{t("noResults")}</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={`${h.path}-${i}`}
                className="ft-row ft-hit"
                onClick={() => !h.isDir && openFile(h.path)}
                title={h.path}
              >
                <span className="ft-icon"><Icon name={h.isDir ? "folder" : "file"} size={13} /></span>
                <span className="ft-name">{h.name}</span>
                {h.line && <span className="ft-hit-line">:{h.line}</span>}
                {h.preview && <span className="ft-hit-preview">{h.preview}</span>}
              </button>
            ))
          )
        ) : !cwd ? null : root === null ? (
          <div className="ft-empty">…</div>
        ) : root.length === 0 ? (
          <div className="ft-empty">{t("emptyFolder")}</div>
        ) : (
          root.map((e) => (
            <TreeNode
              key={e.path}
              entry={e}
              depth={0}
              token={token}
              version={reloadKey}
              onOpenFile={openFile}
              onContext={(x, y, entry) => setMenu({ x, y, entry })}
            />
          ))
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entry={menu.entry}
          onNewFile={(e) => setPrompt({ kind: "newFile", target: e })}
          onNewFolder={(e) => setPrompt({ kind: "newFolder", target: e })}
          onRename={(e) => setPrompt({ kind: "rename", target: e })}
          onDelete={del}
          onReveal={(e) => void apiRevealFolder(e.path, token)}
          onClose={() => setMenu(null)}
        />
      )}

      {prompt && (
        <NamePrompt
          title={
            prompt.kind === "newFile" ? t("newFile") : prompt.kind === "newFolder" ? t("newFolder") : t("rename")
          }
          initial={prompt.kind === "rename" ? prompt.target.name : ""}
          confirmLabel={prompt.kind === "rename" ? t("rename") : t("create")}
          cancelLabel={t("cancel")}
          onConfirm={runPrompt}
          onCancel={() => setPrompt(null)}
        />
      )}

      {active && (
        <EditorModal
          tabs={tabs}
          activePath={activePath}
          onSelect={setActivePath}
          onChange={setTabContent}
          onSave={saveTab}
          onCloseTab={closeTab}
          onCloseAll={() => {
            setTabs([]);
            setActivePath(null);
          }}
        />
      )}
    </aside>
  );
}

/** P6.9.9 — image viewer tab. Bytes come from the confined /api/fs/raw route
 *  (token in a header, never in the URL) and are shown via an object URL. */
function ImageView({ path }: { path: string }) {
  const t = useT();
  const token = useAgent((s) => s.token);
  const fsRefresh = useAgent((s) => s.fsRefresh);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    fetch(`/api/fs/raw?path=${encodeURIComponent(path)}`, {
      headers: token ? { "x-ccw-token": token } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error("raw failed");
        return r.blob();
      })
      .then((b) => {
        if (cancelled) return;
        objUrl = URL.createObjectURL(b);
        setUrl(objUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [path, token, fsRefresh]);

  if (failed) return <div className="ft-empty">{t("imgLoadFailed")}</div>;
  // Object URLs can't go through next/image optimization — plain <img> is right here.
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="image-view">{url && <img src={url} alt={path.split("/").pop() ?? ""} />}</div>;
}

function TreeNode({
  entry,
  depth,
  token,
  version,
  onOpenFile,
  onContext,
}: {
  entry: Entry;
  depth: number;
  token: string | null;
  version: number;
  onOpenFile: (path: string) => void;
  onContext: (x: number, y: number, entry: Entry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);

  const load = useCallback(async () => {
    const d = await apiListDir(entry.path, token);
    setChildren(d.ok ? d.entries ?? [] : []);
  }, [entry.path, token]);

  // Re-fetch an open folder's children after a mutation elsewhere bumps version.
  useEffect(() => {
    if (open) void load();
  }, [version, open, load]);

  const toggle = async () => {
    if (!entry.isDir) {
      onOpenFile(entry.path);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) await load();
  };

  return (
    <div>
      <button
        className="ft-row"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault();
          onContext(e.clientX, e.clientY, entry);
        }}
        title={entry.name}
      >
        <span className="ft-icon"><Icon name={entry.isDir ? (open ? "folderOpen" : "folder") : "file"} size={13} /></span>
        <span className="ft-name">{entry.name}</span>
        <span
          className="ft-more"
          role="button"
          aria-label="menu"
          onClick={(e) => {
            e.stopPropagation();
            onContext(e.clientX, e.clientY, entry);
          }}
        >
          ⋯
        </span>
      </button>
      {entry.isDir &&
        open &&
        children &&
        children.map((c) => (
          <TreeNode
            key={c.path}
            entry={c}
            depth={depth + 1}
            token={token}
            version={version}
            onOpenFile={onOpenFile}
            onContext={onContext}
          />
        ))}
    </div>
  );
}

function ContextMenu({
  x,
  y,
  entry,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onReveal,
  onClose,
}: {
  x: number;
  y: number;
  entry: Entry;
  onNewFile: (e: Entry) => void;
  onNewFolder: (e: Entry) => void;
  onRename: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  onReveal: (e: Entry) => void;
  onClose: () => void;
}) {
  const t = useT();
  const item = (label: string, fn: () => void) => (
    <button
      className="ctx-item"
      onClick={() => {
        fn();
        onClose();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="ctx-menu" style={{ top: y, left: x }} onClick={(e) => e.stopPropagation()}>
      {entry.isDir && item(t("newFile"), () => onNewFile(entry))}
      {entry.isDir && item(t("newFolder"), () => onNewFolder(entry))}
      {item(t("rename"), () => onRename(entry))}
      {item(t("deleteAction"), () => onDelete(entry))}
      {entry.isDir && item(t("openFolderTip"), () => onReveal(entry))}
    </div>
  );
}

function NamePrompt({
  title,
  initial,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  initial: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="name-prompt" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input
          className="field-input"
          value={name}
          autoFocus
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ok) onConfirm(name.trim());
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="btn btn-primary" disabled={!ok} onClick={() => onConfirm(name.trim())}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorModal({
  tabs,
  activePath,
  onSelect,
  onChange,
  onSave,
  onCloseTab,
  onCloseAll,
}: {
  tabs: Tab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onCloseTab: (path: string) => void;
  onCloseAll: () => void;
}) {
  const t = useT();
  const active = tabs.find((tb) => tb.path === activePath) ?? null;
  const dirty = active ? active.content !== active.saved : false;

  return (
    <div className="modal-backdrop" onClick={onCloseAll}>
      <div className="editor-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="editor-tabs">
          {tabs.map((tb) => (
            <button
              key={tb.path}
              className={`editor-tab ${tb.path === activePath ? "editor-tab-active" : ""}`}
              onClick={() => onSelect(tb.path)}
              title={tb.path}
            >
              {tb.content !== tb.saved && <span className="editor-dirty">●</span>}
              <span className="editor-tab-name">{tb.name}</span>
              <span
                className="editor-tab-close"
                role="button"
                aria-label={t("close")}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tb.path);
                }}
              >
                <Icon name="x" size={13} />
              </span>
            </button>
          ))}
          <span className="editor-tabs-spacer" />
          <button className="icon-btn icon-btn-sm" onClick={onCloseAll} aria-label={t("close")}>
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="editor-body">
          {active &&
            (active.image ? (
              <ImageView key={active.path} path={active.path} />
            ) : active.binary ? (
              <div className="ft-empty">{t("binaryFile")}</div>
            ) : active.tooBig ? (
              <div className="ft-empty">{t("fileTooBig")}</div>
            ) : (
              <CodeEditor
                key={active.path}
                fileName={active.name}
                value={active.content}
                onChange={(v) => onChange(active.path, v)}
                onSave={() => onSave(active.path)}
              />
            ))}
        </div>

        {active && !active.binary && !active.tooBig && (
          <div className="editor-foot">
            <span className="editor-status">{dirty ? t("unsaved") : t("saved")}</span>
            <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => onSave(active.path)}>
              {t("save")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
