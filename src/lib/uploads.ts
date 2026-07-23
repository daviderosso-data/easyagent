// Client-side helpers for chat/orchestrator uploads. Mirrors the server
// allowlist in src/server/fs-upload.ts (the server re-validates everything).

export const UPLOAD_ACCEPT = ".pdf,.md,.markdown,.txt,.csv,.json,.png,.jpg,.jpeg,.gif,.webp";
export const UPLOAD_MAX_BYTES = 20_000_000;
export const UPLOAD_MAX_FILES = 8;

const ALLOWED_EXT = new Set(["pdf", "md", "markdown", "txt", "csv", "json", "png", "jpg", "jpeg", "gif", "webp"]);
const TEXT_EXT = new Set(["md", "markdown", "txt", "csv", "json"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function uploadAllowed(name: string): boolean {
  return ALLOWED_EXT.has(extOf(name));
}

export type UploadReject = "type" | "big" | "many";

/** Merge picked/dropped files into the current list: filter the allowlist and
 *  size cap, skip duplicates, keep at most UPLOAD_MAX_FILES. */
export function addUploadFiles(
  current: File[],
  incoming: Iterable<File>,
  onReject: (why: UploadReject) => void,
): File[] {
  const next = [...current];
  for (const f of incoming) {
    if (!uploadAllowed(f.name)) {
      onReject("type");
      continue;
    }
    if (f.size > UPLOAD_MAX_BYTES) {
      onReject("big");
      continue;
    }
    if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
    if (next.length >= UPLOAD_MAX_FILES) {
      onReject("many");
      break;
    }
    next.push(f);
  }
  return next;
}

export interface UploadReference {
  name: string;
  excerpt?: string;
}

/** Text excerpts for the orchestrator planner: readable formats contribute a
 *  capped snippet; PDFs/images contribute their name only (the agents read
 *  the full files from reference/ once the project exists). */
export async function readExcerpts(files: File[], capEach = 3000, capTotal = 9000): Promise<UploadReference[]> {
  const out: UploadReference[] = [];
  let budget = capTotal;
  for (const f of files) {
    if (!TEXT_EXT.has(extOf(f.name)) || budget <= 0) {
      out.push({ name: f.name });
      continue;
    }
    try {
      const text = (await f.text()).slice(0, Math.min(capEach, budget)).trim();
      budget -= text.length;
      out.push(text ? { name: f.name, excerpt: text } : { name: f.name });
    } catch {
      out.push({ name: f.name });
    }
  }
  return out;
}
