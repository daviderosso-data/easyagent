"use client";

import { useEffect, useMemo, useState } from "react";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { useT } from "@/i18n";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { Icon } from "@/components/icons";

/** Pick a CodeMirror language extension from a filename. Unknown types render
 *  as plain text (still editable, no highlighting). */
function languageFor(name: string): Extension | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript();
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: ext === "tsx" });
    case "py":
      return python();
    case "json":
      return json();
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return html();
    case "md":
    case "markdown":
      return markdown();
    default:
      return null;
  }
}

/** Follow the app theme (`<html data-theme>` + prefers-color-scheme). */
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const compute = () => {
      const attr = root.getAttribute("data-theme");
      if (attr === "dark") return true;
      if (attr === "light") return false;
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    };
    setDark(compute());
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMq = () => setDark(compute());
    mq?.addEventListener?.("change", onMq);
    const obs = new MutationObserver(() => setDark(compute()));
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq?.removeEventListener?.("change", onMq);
      obs.disconnect();
    };
  }, []);
  return dark;
}

export function CodeEditor({
  fileName,
  value,
  onChange,
  onSave,
  readOnly = false,
}: {
  fileName: string;
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}) {
  const t = useT();
  const dark = useIsDark();
  const [view, setView] = useState<EditorView | null>(null);
  const [wrap, setWrap] = useState(true);
  const extensions = useMemo(() => {
    const exts: Extension[] = wrap ? [EditorView.lineWrapping] : [];
    const lang = languageFor(fileName);
    if (lang) exts.push(lang);
    if (onSave) {
      // Cmd/Ctrl+S saves without inserting a character.
      exts.push(
        EditorView.domEventHandlers({
          keydown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              onSave();
              return true;
            }
            return false;
          },
        }),
      );
    }
    return exts;
  }, [fileName, onSave, wrap]);

  // Toolbar actions act on the live editor view (keyboard shortcuts still work).
  const act = (fn: (v: EditorView) => unknown) => {
    if (view) {
      fn(view);
      view.focus();
    }
  };

  return (
    <div className="code-editor">
      <div className="editor-toolbar">
        {!readOnly && (
          <>
            <button className="icon-btn icon-btn-sm" title={`${t("undoTip")} (⌘Z)`} onClick={() => act(undo)}>
              <Icon name="undo" size={15} />
            </button>
            <button className="icon-btn icon-btn-sm" title={`${t("redoTip")} (⇧⌘Z)`} onClick={() => act(redo)}>
              <Icon name="redo" size={15} />
            </button>
          </>
        )}
        <button className="icon-btn icon-btn-sm" title={`${t("findTip")} (⌘F)`} onClick={() => act(openSearchPanel)}>
          <Icon name="search" size={14} />
        </button>
        <button
          className={`icon-btn icon-btn-sm ${wrap ? "toolbar-on" : ""}`}
          title={t("wrapTip")}
          onClick={() => setWrap((w) => !w)}
        >
          <Icon name="wrap" size={15} />
        </button>
      </div>
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        theme={dark ? oneDark : "light"}
        extensions={extensions}
        basicSetup={{ lineNumbers: true, highlightActiveLine: !readOnly, foldGutter: true }}
        onCreateEditor={(v) => setView(v)}
        height="100%"
        style={{ flex: 1, minHeight: 0, fontSize: "13px" }}
      />
    </div>
  );
}
