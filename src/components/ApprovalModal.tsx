"use client";

import { useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { useT, useLang, describeTool, riskReason } from "@/i18n";
import { DiffView } from "@/components/DiffView";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);

export function ApprovalModal({ id }: { id: string }) {
  // Head of the approval queue: requests are answered one at a time, oldest
  // first (the SDK can issue parallel tool calls).
  const pending = useAgent((s) => s.sessions[id]?.pending[0]);
  const queued = useAgent((s) => s.sessions[id]?.pending.length ?? 0);
  const respond = useAgent((s) => s.respondApproval);
  const t = useT();
  const lang = useLang();
  const [typed, setTyped] = useState("");

  // Reset the type-to-confirm field whenever the request at the head changes.
  // The modal stays mounted for the panel's whole life, so without this a typed
  // CONFIRM would survive a Stop (or queue advance) and pre-satisfy the NEXT
  // red action — approving a dangerous op with no typing.
  const headId = pending?.approvalId;
  useEffect(() => {
    setTyped("");
  }, [headId]);

  if (!pending) return null;

  const isRed = pending.risk === "red";
  const isEdit = EDIT_TOOLS.has(pending.toolName);
  const isBash = pending.toolName === "Bash";
  const command = typeof pending.input.command === "string" ? pending.input.command : "";
  const description = describeTool(pending.toolName, pending.input, lang);
  const reason = riskReason(pending.severity, lang);
  const confirmWord = t("confirmWord");
  const canProceed = !isRed || typed.trim().toUpperCase() === confirmWord;

  const close = (decision: "allow" | "deny", always?: boolean) => {
    setTyped("");
    respond(id, decision, always);
  };

  return (
    <div className="approval-overlay" role="dialog" aria-modal="true">
      <div className={`modal ${isRed ? "modal-red" : ""}`}>
        <div className="modal-head">
          <span className={`modal-badge ${isRed ? "modal-badge-red" : ""}`}>
            {isRed ? t("delicate") : t("needsOk")}
          </span>
          {queued > 1 && <span className="modal-badge">+{queued - 1} {t("moreApprovals")}</span>}
          <h2>{description.split("\n")[0]}</h2>
        </div>

        <div className="modal-body">
          {isRed && reason && <p className="red-warning">Claude {reason}.</p>}
          {isEdit && <DiffView toolName={pending.toolName} input={pending.input} />}
          {isBash && (
            <pre className="cmd-preview">
              <span className="cmd-prompt">$</span> {command}
            </pre>
          )}
          {!isEdit && !isBash && <p className="modal-note">{description}</p>}

          {isRed && (
            <label className="confirm-field">
              <span>
                {t("typeToConfirm")} <b>{confirmWord}</b>:
              </span>
              <input
                className="field-input"
                value={typed}
                autoFocus
                spellCheck={false}
                placeholder={confirmWord}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => close("deny")}>
            {t("deny")}
          </button>
          {isEdit && !isRed && (
            <button className="btn btn-soft" onClick={() => close("allow", true)}>
              {t("allowAlways")}
            </button>
          )}
          <button
            className={`btn ${isRed ? "btn-danger" : "btn-primary"}`}
            disabled={!canProceed}
            onClick={() => close("allow")}
          >
            {isRed ? t("proceedRed") : t("proceed")}
          </button>
        </div>
      </div>
    </div>
  );
}
