// In-process registry of active agent turns. Pinned on globalThis so Next.js dev
// HMR (which re-evaluates modules) doesn't create duplicates and orphan running
// Claude Code subprocesses.

/** The decision the UI sends back; agent-runner turns it into a full
 *  PermissionResult (injecting the original tool input for `allow`). */
export interface ApprovalDecision {
  allow: boolean;
  message?: string;
}

/** Minimal view of the SDK Query object we actually drive. */
export interface LiveQuery {
  interrupt?: () => Promise<void> | void;
  setPermissionMode?: (mode: string) => Promise<void> | void;
}

export interface Turn {
  turnId: string;
  abort: AbortController;
  query?: LiveQuery;
  /** approvalId -> resolver waiting inside canUseTool */
  pendingApprovals: Map<string, (decision: ApprovalDecision) => void>;
}

class SessionManager {
  private turns = new Map<string, Turn>();

  create(turnId: string, abort: AbortController): Turn {
    const turn: Turn = { turnId, abort, pendingApprovals: new Map() };
    this.turns.set(turnId, turn);
    return turn;
  }

  /** Atomically reserve a concurrency slot and register the turn. The size
   *  check and the insert happen in one synchronous step, so parallel requests
   *  can't over-commit past `max`. Returns null when the cap is reached. */
  tryCreate(turnId: string, abort: AbortController, max: number): Turn | null {
    if (this.turns.size >= max) return null;
    return this.create(turnId, abort);
  }

  /** Best-effort interrupt + abort. Used by Stop and by client disconnects. */
  abort(turnId: string): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    try {
      turn.query?.interrupt?.();
    } catch {
      /* best effort */
    }
    turn.abort.abort();
  }

  get(turnId: string): Turn | undefined {
    return this.turns.get(turnId);
  }

  /** Number of turns currently running (for the concurrency cap). */
  size(): number {
    return this.turns.size;
  }

  end(turnId: string): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    // Fail-closed: reject any still-pending approvals so the SDK unblocks.
    for (const resolve of turn.pendingApprovals.values()) {
      resolve({ allow: false, message: "Sessione terminata." });
    }
    turn.pendingApprovals.clear();
    this.turns.delete(turnId);
  }
}

const globalRef = globalThis as unknown as { __ccw_sessionManager?: SessionManager };
export const sessionManager: SessionManager =
  globalRef.__ccw_sessionManager ?? (globalRef.__ccw_sessionManager = new SessionManager());
