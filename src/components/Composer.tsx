"use client";

import { useEffect, useRef, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { apiUpload } from "@/lib/fs-client";
import { addUploadFiles, UPLOAD_ACCEPT, type UploadReject } from "@/lib/uploads";
import { CommandPalette } from "@/components/CommandPalette";
import { Icon } from "@/components/icons";

const REJECT_TOAST = { type: "toastFileType", big: "toastFileTooBig", many: "toastTooManyFiles" } as const;

export function Composer({ id }: { id: string }) {
  const [text, setText] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const running = useAgent((s) => s.sessions[id]?.running ?? false);
  const cwd = useAgent((s) => s.sessions[id]?.cwd ?? "");
  const provider = useAgent((s) => s.sessions[id]?.provider ?? "claude");
  const providers = useAgent((s) => s.providers);
  const send = useAgent((s) => s.send);
  const stop = useAgent((s) => s.stop);
  const token = useAgent((s) => s.token);
  const pushToast = useAgent((s) => s.pushToast);
  const bumpFsRefresh = useAgent((s) => s.bumpFsRefresh);
  const t = useT();

  const addFiles = (incoming: Iterable<File>) => {
    if (!cwd || running) return;
    setFiles((cur) => addUploadFiles(cur, incoming, (why: UploadReject) => pushToast(REJECT_TOAST[why])));
  };

  // While a file is dragged anywhere over the window: (1) neutralize the
  // browser's default drop (which would REPLACE the app with the file), and
  // (2) light up this composer so the drop target is obvious.
  const [fileDragActive, setFileDragActive] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const isFileDrag = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onWindowDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setFileDragActive(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setFileDragActive(false), 250);
    };
    const onWindowDrop = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
      setFileDragActive(false);
    };
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
      window.clearTimeout(timer);
    };
  }, []);
  // The palette lists Claude Code slash commands — hide it on engines without them.
  const slashCommands = providers.find((p) => p.id === provider)?.capabilities.slashCommands ?? provider === "claude";

  // Global Cmd/Ctrl+K targets the active panel's palette.
  const paletteReq = useAgent((s) => s.paletteRequest);
  const handledNonce = useRef(0);
  useEffect(() => {
    if (!paletteReq || paletteReq.panelId !== id || paletteReq.nonce === handledNonce.current) return;
    handledNonce.current = paletteReq.nonce;
    if (!running && cwd && slashCommands) setPaletteOpen(true);
  }, [paletteReq, id, running, cwd, slashCommands]);

  const presets: { label: string; prompt: string }[] = [
    { label: t("presetExplain"), prompt: "Explain what this project does and how it's organized, in simple terms." },
    { label: t("presetFix"), prompt: "Look for any bugs in this project and propose how to fix them." },
    { label: t("presetTests"), prompt: "Write tests for the main parts of this project." },
    { label: t("presetSummary"), prompt: "Show me what changed recently with git and summarize it simply." },
  ];

  const submit = async () => {
    const val = text.trim();
    if ((!val && files.length === 0) || running || !cwd || uploading) return;
    let prompt = val;
    if (files.length) {
      // Save the attachments into the project first, then reference their
      // paths in the prompt — works identically on every engine.
      setUploading(true);
      const up = await apiUpload(files, token, { cwd });
      setUploading(false);
      if (!up.ok || !up.files) {
        pushToast("toastUpload");
        return;
      }
      const note = `${t("attachHeader")}\n${up.files.map((f) => `- ${f.rel ?? f.name}`).join("\n")}\n${t("attachFooter")}`;
      prompt = val ? `${val}\n\n${note}` : note;
      setFiles([]);
      bumpFsRefresh();
    }
    setText("");
    void send(id, prompt);
  };

  const insertCommand = (val: string) => {
    setText(val);
    const el = inputRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(val.length, val.length));
    }
  };

  return (
    <div
      className={`composer ${dragOver ? "composer-drop" : fileDragActive && cwd && !running ? "composer-drop-hint" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="presets">
        {slashCommands && (
          <button
            className="cmd-trigger"
            disabled={running || !cwd}
            onClick={() => setPaletteOpen(true)}
            title={t("commandsTip")}
          >
            / {t("commands")}
          </button>
        )}
        {presets.map((p) => (
          <button
            key={p.label}
            className="preset"
            disabled={running || !cwd}
            onClick={() => {
              if (running || !cwd) return;
              void send(id, p.prompt);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {files.length > 0 && (
        <div className="attach-chips">
          {files.map((f) => (
            <span className="attach-chip" key={f.name + f.size}>
              <Icon name="file" size={11} />
              <span className="attach-chip-name">{f.name}</span>
              <button
                className="attach-chip-x"
                aria-label={t("close")}
                onClick={() => setFiles((cur) => cur.filter((x) => x !== f))}
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          <span className="attach-uploading">{uploading ? t("uploadingLbl") : t("attachPendingHint")}</span>
        </div>
      )}

      <div className="composer-row">
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept={UPLOAD_ACCEPT}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          className="icon-btn attach-btn"
          disabled={running || !cwd || uploading}
          title={t("attachTip")}
          aria-label={t("attachTip")}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="paperclip" size={14} />
        </button>
        <textarea
          ref={inputRef}
          className="composer-input"
          placeholder={t("inputPlaceholder")}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {running ? (
          <button className="btn btn-stop" onClick={() => void stop(id)}>
            <Icon name="stop" size={13} /> {t("stop")}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-send"
            onClick={() => void submit()}
            disabled={(!text.trim() && files.length === 0) || !cwd || uploading}
          >
            {t("send")} ▸
          </button>
        )}
      </div>

      {paletteOpen && (
        <CommandPalette
          panelId={id}
          cwd={cwd}
          onInsert={insertCommand}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
