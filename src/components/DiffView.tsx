"use client";

import { diffLines } from "diff";

/** Visual before/after diff for Edit/Write tool inputs. */
export function DiffView({
  toolName,
  input,
  compact = false,
}: {
  toolName: string;
  input: Record<string, unknown>;
  compact?: boolean;
}) {
  const oldText =
    toolName === "Write" ? "" : typeof input.old_string === "string" ? input.old_string : "";
  const newText =
    toolName === "Write"
      ? typeof input.content === "string"
        ? input.content
        : ""
      : typeof input.new_string === "string"
        ? input.new_string
        : "";

  if (!oldText && !newText) {
    return <p className="diff-empty">Nessuna anteprima disponibile.</p>;
  }

  const parts = diffLines(oldText, newText);

  return (
    <pre className={`diff ${compact ? "diff-compact" : ""}`}>
      {parts.map((p, i) => {
        const cls = p.added ? "diff-add" : p.removed ? "diff-del" : "diff-ctx";
        const sign = p.added ? "+" : p.removed ? "−" : " ";
        const lines = p.value.replace(/\n$/, "").split("\n");
        return lines.map((ln, j) => (
          <span key={`${i}-${j}`} className={`diff-line ${cls}`}>
            <span className="diff-sign">{sign}</span>
            {ln || " "}
          </span>
        ));
      })}
    </pre>
  );
}
