"use client";

import { diffLines } from "diff";
import { useT } from "@/i18n";

interface EditPair {
  old: string;
  new: string;
}

/** Normalize an Edit / Write / MultiEdit tool input into before/after pairs. */
function editPairs(toolName: string, input: Record<string, unknown>): EditPair[] {
  if (toolName === "Write") {
    return [{ old: "", new: typeof input.content === "string" ? input.content : "" }];
  }
  if (toolName === "MultiEdit" && Array.isArray(input.edits)) {
    return (input.edits as unknown[])
      .map((e) => e as Record<string, unknown>)
      .map((e) => ({
        old: typeof e.old_string === "string" ? e.old_string : "",
        new: typeof e.new_string === "string" ? e.new_string : "",
      }));
  }
  return [
    {
      old: typeof input.old_string === "string" ? input.old_string : "",
      new: typeof input.new_string === "string" ? input.new_string : "",
    },
  ];
}

/** Visual before/after diff for Edit/Write/MultiEdit tool inputs. */
export function DiffView({
  toolName,
  input,
  compact = false,
}: {
  toolName: string;
  input: Record<string, unknown>;
  compact?: boolean;
}) {
  const t = useT();
  const pairs = editPairs(toolName, input).filter((p) => p.old || p.new);

  if (pairs.length === 0) {
    return <p className="diff-empty">{t("noPreview")}</p>;
  }

  return (
    <>
      {pairs.map((pair, pi) => (
        <DiffText key={pi} oldText={pair.old} newText={pair.new} compact={compact} />
      ))}
    </>
  );
}

/** Line-level before/after diff of two plain texts (shared by tool diffs and save-point diffs). */
export function DiffText({ oldText, newText, compact = false }: { oldText: string; newText: string; compact?: boolean }) {
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
            {ln || " "}
          </span>
        ));
      })}
    </pre>
  );
}
