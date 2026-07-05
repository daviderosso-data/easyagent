"use client";

import { useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";

export function Composer({ id }: { id: string }) {
  const [text, setText] = useState("");
  const running = useAgent((s) => s.sessions[id]?.running ?? false);
  const cwd = useAgent((s) => s.sessions[id]?.cwd ?? "");
  const send = useAgent((s) => s.send);
  const stop = useAgent((s) => s.stop);
  const t = useT();

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

  return (
    <div className="composer">
      <div className="presets">
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
            ◼ {t("stop")}
          </button>
        ) : (
          <button className="btn btn-primary btn-send" onClick={submit} disabled={!text.trim() || !cwd}>
            {t("send")} ▸
          </button>
        )}
      </div>
    </div>
  );
}
