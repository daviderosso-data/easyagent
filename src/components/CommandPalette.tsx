"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { apiListCommands, type CommandInfo } from "@/lib/commands-client";
import { Icon } from "@/components/icons";

export function CommandPalette({
  panelId,
  cwd,
  onInsert,
  onClose,
}: {
  panelId: string;
  cwd: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const token = useAgent((s) => s.token);
  const send = useAgent((s) => s.send);
  const t = useT();
  const [commands, setCommands] = useState<CommandInfo[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    apiListCommands(cwd, token).then((d) => {
      if (!alive) return;
      if (d.ok) setCommands(d.commands);
      else setError(true);
    });
    return () => {
      alive = false;
    };
  }, [cwd, token]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!commands) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle) ||
        c.aliases.some((a) => a.toLowerCase().includes(needle)),
    );
  }, [commands, q]);

  const run = (c: CommandInfo) => {
    onClose();
    if (c.argumentHint) onInsert(`/${c.name} `);
    else void send(panelId, `/${c.name}`);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={t("commands")} onClick={(e) => e.stopPropagation()}>
        <div className="cmd-head">
          <input
            ref={searchRef}
            className="cmd-search"
            placeholder={t("searchCommands")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "Enter" && filtered.length) run(filtered[0]);
            }}
          />
          <button className="icon-btn" onClick={onClose} aria-label="close">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="cmd-hint">{t("commandsHint")}</div>
        <div className="cmd-list">
          {commands === null && !error ? (
            <div className="cmd-empty">{t("commandsLoading")}</div>
          ) : error ? (
            <div className="cmd-empty">{t("commandsError")}</div>
          ) : filtered.length === 0 ? (
            <div className="cmd-empty">{t("noCommands")}</div>
          ) : (
            filtered.map((c) => (
              <button key={c.name} className="cmd-row" onClick={() => run(c)}>
                <span className="cmd-name">
                  /{c.name}
                  {c.argumentHint ? <span className="cmd-hintarg"> {c.argumentHint}</span> : null}
                </span>
                {c.description ? <span className="cmd-desc">{c.description}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
