import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Normalize a path the same way validateCwd does (symlinks resolved), so the
 *  grant's scope and the incoming cwd are compared on equal terms. */
function normalize(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}

// Server-minted grants that let orchestration turns run with the autonomous
// ORCHESTRATION_CONFIG. Minted only by /api/orchestrate, scoped to the new
// project's root and time-limited — so a client request body can never
// downgrade the security profile on its own. Pinned on globalThis so Next
// dev HMR keeps grants alive across reloads.

interface Grant {
  projectRoot: string;
  expiresAt: number;
}

// Generous: an orchestration spans several long agent rounds.
const TTL_MS = 6 * 60 * 60 * 1000;

class GrantStore {
  private grants = new Map<string, Grant>();

  mint(projectRoot: string): string {
    this.sweep();
    const id = randomUUID();
    this.grants.set(id, { projectRoot: normalize(projectRoot), expiresAt: Date.now() + TTL_MS });
    return id;
  }

  /** Valid = known, not expired, and cwd inside the granted project root. `cwd`
   *  is expected to already be the realpath-normalized path validateCwd returns. */
  validFor(id: unknown, cwd: string): boolean {
    if (typeof id !== "string" || id === "") return false;
    const g = this.grants.get(id);
    if (!g) return false;
    if (Date.now() > g.expiresAt) {
      this.grants.delete(id);
      return false;
    }
    const p = normalize(cwd);
    return p === g.projectRoot || p.startsWith(g.projectRoot + sep);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, g] of this.grants) {
      if (now > g.expiresAt) this.grants.delete(id);
    }
  }
}

const g = globalThis as unknown as { __ccw_orchGrants?: GrantStore };
export const orchestrationGrants: GrantStore = (g.__ccw_orchGrants ??= new GrantStore());
