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

/** What a pending approval looks like to a client that did NOT start the turn
 *  (P7.1 remote view). The metadata used to live only in the browser that
 *  opened the SSE stream; keeping it here lets the phone list approvals too. */
export interface ApprovalMeta {
  approvalId: string;
  turnId: string;
  toolName: string;
  title: string;
  /** What the action acts on (file path, command…). The remote view has no
   *  diff panel, so without this you would be approving blind. */
  target?: string;
  risk: "normal" | "red";
  severity: string;
  askedAt: number;
}

export interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  meta: ApprovalMeta;
}

export interface Turn {
  turnId: string;
  abort: AbortController;
  query?: LiveQuery;
  /** Realpath cwd of the turn — lets features scoped to a project (e.g. save-point restore) detect activity. */
  cwd?: string;
  /** Project root and panel label, for the remote list (P7.1). */
  project?: string;
  roleLabel?: string;
  /** Pushes an event into this turn's SSE stream (the desktop that started it),
   *  so a decision taken elsewhere — e.g. from the phone — is reflected there. */
  emit?: (e: unknown) => void;
  /** approvalId -> resolver waiting inside canUseTool, plus its display metadata */
  pendingApprovals: Map<string, PendingApproval>;
}

/** One-line "what does this act on", for clients with no diff view (P7.1).
 *  Reads the usual tool-input keys and truncates — never the file contents. */
export function approvalTarget(input: Record<string, unknown>): string | undefined {
  for (const k of ["command", "file_path", "path", "url", "pattern", "notebook_path"]) {
    const v = input?.[k];
    if (typeof v === "string" && v.trim()) {
      const s = v.trim().replace(/\s+/g, " ");
      return s.length > 160 ? `${s.slice(0, 159)}…` : s;
    }
  }
  return undefined;
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

  /** P7.1 — every live turn, for the remote read-only view. */
  listTurns(): { turnId: string; cwd?: string; project?: string; roleLabel?: string; pending: number }[] {
    return [...this.turns.values()].map((t) => ({
      turnId: t.turnId,
      cwd: t.cwd,
      project: t.project,
      roleLabel: t.roleLabel,
      pending: t.pendingApprovals.size,
    }));
  }

  /** P7.1 — every approval waiting for a human, across all turns. */
  listApprovals(): (ApprovalMeta & { project?: string; roleLabel?: string })[] {
    const out: (ApprovalMeta & { project?: string; roleLabel?: string })[] = [];
    for (const t of this.turns.values()) {
      for (const p of t.pendingApprovals.values()) {
        out.push({ ...p.meta, project: t.project, roleLabel: t.roleLabel });
      }
    }
    return out.sort((a, b) => a.askedAt - b.askedAt);
  }

  /** Whether any turn is running inside the given directory (or a subfolder). */
  anyRunningUnder(pathPrefix: string): boolean {
    for (const turn of this.turns.values()) {
      const c = turn.cwd;
      if (c && (c === pathPrefix || c.startsWith(pathPrefix + "/") || c.startsWith(pathPrefix + "\\"))) return true;
    }
    return false;
  }

  end(turnId: string): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    // Fail-closed: reject any still-pending approvals so the SDK unblocks.
    for (const p of turn.pendingApprovals.values()) {
      p.resolve({ allow: false, message: "Session ended." });
    }
    turn.pendingApprovals.clear();
    this.turns.delete(turnId);
  }
}

const globalRef = globalThis as unknown as { __ccw_sessionManager?: SessionManager };
export const sessionManager: SessionManager =
  globalRef.__ccw_sessionManager ?? (globalRef.__ccw_sessionManager = new SessionManager());
