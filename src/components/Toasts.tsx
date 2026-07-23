"use client";

import { useAgent } from "@/store/agent";
import { useT } from "@/i18n";
import { Icon } from "@/components/icons";

/** Corner stack for non-blocking failures (store.pushToast). One notice per
 *  problem, auto-dismissed — errors must be visible, never modal. */
export function Toasts() {
  const toasts = useAgent((s) => s.toasts);
  const dismiss = useAgent((s) => s.dismissToast);
  const t = useT();

  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span className="toast-text">{toast.message}</span>
          <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label={t("dismiss")}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
