"use client";

import { useEffect, useRef } from "react";
import { useAgent, type Item } from "@/store/agent";
import { DiffView } from "@/components/DiffView";
import { useT, useLang, labelTool } from "@/i18n";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);
const EMPTY: Item[] = [];

export function Transcript({ id }: { id: string }) {
  const items = useAgent((s) => s.sessions[id]?.items ?? EMPTY);
  const running = useAgent((s) => s.sessions[id]?.running ?? false);
  const t = useT();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, running]);

  if (items.length === 0) {
    return (
      <div className="empty">
        <div className="empty-emoji">👋</div>
        <h2>{t("emptyTitle")}</h2>
        <p>{t("emptyBody")}</p>
        <p className="empty-hint">{t("emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="transcript">
      {items.map((it) => (
        <Row key={it.id + it.kind} item={it} />
      ))}
      {running && <div className="typing">{t("working")}</div>}
      <div ref={endRef} />
    </div>
  );
}

function Row({ item }: { item: Item }) {
  const t = useT();

  switch (item.kind) {
    case "user":
      return (
        <div className="row row-user">
          <div className="bubble bubble-user">{item.text}</div>
        </div>
      );
    case "assistant":
      return (
        <div className="row row-assistant">
          <div className="bubble bubble-assistant">{item.text}</div>
        </div>
      );
    case "thinking":
      return (
        <details className="thinking">
          <summary>{t("reasoning")}</summary>
          <div className="thinking-body">{item.text}</div>
        </details>
      );
    case "tool":
      return <ToolCard item={item} />;
    case "done":
      return (
        <div className="done">
          <span>✓ {t("done")}</span>
          <span className="done-meta">
            {item.numTurns} {t("steps")} · {(item.durationMs / 1000).toFixed(1)}s · ~$
            {item.costUsd.toFixed(3)} ({t("estimated")})
          </span>
        </div>
      );
    case "error":
      return <div className="err">⚠️ {item.message}</div>;
  }
}

function ToolCard({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const t = useT();
  const lang = useLang();
  const isEdit = EDIT_TOOLS.has(item.name);
  const isBash = item.name === "Bash";
  const command = typeof item.input.command === "string" ? item.input.command : "";
  return (
    <div className={`tool ${item.status === "running" ? "tool-running" : ""}`}>
      <div className="tool-head">
        <span className="tool-dot" />
        <span className="tool-label">{labelTool(item.name, item.input, lang)}</span>
        {item.status === "running" && <span className="tool-spin">…</span>}
        {item.isError && <span className="tool-err">!</span>}
      </div>
      {isEdit && (
        <div className="tool-diff">
          <DiffView toolName={item.name} input={item.input} compact />
        </div>
      )}
      {isBash && (
        <div className="tool-bash">
          <pre className="cmd-preview">
            <span className="cmd-prompt">$</span> {command}
          </pre>
          {item.result && <pre className="cmd-output">{truncate(item.result, t("truncated"))}</pre>}
        </div>
      )}
      {!isEdit && !isBash && item.result && (
        <details className="tool-out">
          <summary>{t("result")}</summary>
          <pre>{truncate(item.result, t("truncated"))}</pre>
        </details>
      )}
    </div>
  );
}

function truncate(s: string, suffix: string, max = 4000): string {
  return s.length > max ? s.slice(0, max) + "\n" + suffix : s;
}
