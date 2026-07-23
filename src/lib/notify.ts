// Desktop notifications (P6.9.2): tell the user about events they would miss
// with the app in a background tab or window. Pure gate + thin DOM wrapper so
// the policy is unit-testable.

export type NotifyKind = "turnDone" | "turnError" | "approval" | "orchDone" | "orchError";

/** Quick turns don't notify — the user hasn't had time to switch away. */
export const LONG_TURN_MS = 10_000;

export interface NotifyGate {
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
  /** Whether the app window currently has the user's focus. */
  focused: boolean;
  kind: NotifyKind;
  durationMs?: number;
}

export function shouldNotify(g: NotifyGate): boolean {
  if (!g.enabled || g.permission !== "granted" || g.focused) return false;
  if (g.kind === "turnDone" && (g.durationMs ?? 0) < LONG_TURN_MS) return false;
  return true;
}

export function notifyPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Same-tag notifications replace each other (no per-event pile-up). */
export function deliverNotification(title: string, body: string, tag: string, onClick: () => void): void {
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* notifications must never break the app */
  }
}
