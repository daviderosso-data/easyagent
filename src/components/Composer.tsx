"use client";

import { useRef, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { CommandPalette } from "@/components/CommandPalette";
import { Icon } from "@/components/icons";

export function Composer({ id }: { id: string }) {
  const [text, setText] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const running = useAgent((s) => s.sessions[id]?.running ?? false);
  const cwd = useAgent((s) => s.sessions[id]?.cwd ?? "");
  const provider = useAgent((s) => s.sessions[id]?.provider ?? "claude");
  const providers = useAgent((s) => s.providers);
  const send = useAgent((s) => s.send);
  const stop = useAgent((s) => s.stop);
  const t = useT();
  // The palette lists Claude Code slash commands — hide it on engines without them.
  const slashCommands = providers.find((p) => p.id === provider)?.capabilities.slashCommands ?? provider === "claude";

  const presets: { label: string; prompt: string }[] = [
    { label: t("presetExplain"), prompt: "Explain what this project does and how it's organized, in simple terms." },
    { label: t("presetFix"), prompt: "Look for any bugs in this project and propose how to fix them." },
    { label: t("presetTests"), prompt: "Write tests for the main parts of this project." },
    { label: t("presetSummary"), prompt: "Show me what changed recently with git and summarize it simply." },
  ];

  const submit = () => {
    const val = text.trim();
    if (!val || running || !cwd) return;
    setText("");
    void send(id, val);
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
    <div className="composer">
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

      <div className="composer-row">
        <textarea
          ref={inputRef}
          className="composer-input"
          placeholder={t("inputPlaceholder")}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {running ? (
          <button className="btn btn-stop" onClick={() => void stop(id)}>
            <Icon name="stop" size={13} /> {t("stop")}
          </button>
        ) : (
          <button className="btn btn-primary btn-send" onClick={submit} disabled={!text.trim() || !cwd}>
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
