export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}
export interface ListResult {
  ok: boolean;
  dir?: string;
  parent?: string | null;
  entries?: Entry[];
}
export interface FileResult {
  ok: boolean;
  path?: string;
  name?: string;
  content?: string;
  tooBig?: boolean;
  binary?: boolean;
  size?: number;
}

export interface MutateResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface SearchHit {
  path: string;
  name: string;
  isDir: boolean;
  line?: number;
  preview?: string;
}
export interface SearchResult {
  ok: boolean;
  hits?: SearchHit[];
  truncated?: boolean;
}

function headers(token: string | null): Record<string, string> {
  return token ? { "x-ccw-token": token } : {};
}

function jsonHeaders(token: string | null): Record<string, string> {
  return { ...headers(token), "content-type": "application/json" };
}

async function postJson<T>(url: string, body: unknown, token: string | null, fallback: T): Promise<T> {
  try {
    const r = await fetch(url, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify(body) });
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

export async function apiListDir(dir: string, token: string | null): Promise<ListResult> {
  try {
    const r = await fetch(`/api/fs/list?dir=${encodeURIComponent(dir)}`, { headers: headers(token) });
    return await r.json();
  } catch {
    return { ok: false };
  }
}

export async function apiReadFile(path: string, token: string | null): Promise<FileResult> {
  try {
    const r = await fetch(`/api/fs/file?path=${encodeURIComponent(path)}`, { headers: headers(token) });
    return await r.json();
  } catch {
    return { ok: false };
  }
}

export async function apiRevealFolder(path: string, token: string | null): Promise<boolean> {
  try {
    const r = await fetch("/api/fs/reveal", {
      method: "POST",
      headers: { ...headers(token), "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const d = await r.json();
    return !!d.ok;
  } catch {
    return false;
  }
}

export async function apiMkdir(parent: string, name: string, token: string | null): Promise<MutateResult> {
  return postJson("/api/fs/mkdir", { parent, name }, token, { ok: false });
}

export async function apiNewFile(parent: string, name: string, token: string | null): Promise<MutateResult> {
  return postJson("/api/fs/new", { parent, name }, token, { ok: false });
}

export async function apiWriteFile(path: string, content: string, token: string | null): Promise<MutateResult> {
  return postJson("/api/fs/write", { path, content }, token, { ok: false });
}

export async function apiRename(path: string, newName: string, token: string | null): Promise<MutateResult> {
  return postJson("/api/fs/rename", { path, newName }, token, { ok: false });
}

export async function apiMove(path: string, destDir: string, token: string | null): Promise<MutateResult> {
  return postJson("/api/fs/move", { path, destDir }, token, { ok: false });
}

export async function apiDelete(path: string, token: string | null): Promise<MutateResult> {
  return postJson("/api/fs/delete", { path }, token, { ok: false });
}

export interface UploadResult {
  ok: boolean;
  files?: { name: string; rel?: string }[];
  stagingId?: string;
  error?: string;
  file?: string;
}

/** Upload files into <cwd>/attachments/ — or, with staging, into the server
 *  staging area for a project that does not exist yet (orchestrator flow). */
export async function apiUpload(
  files: File[],
  token: string | null,
  opts: { cwd?: string; staging?: boolean },
): Promise<UploadResult> {
  const fd = new FormData();
  if (opts.staging) fd.set("staging", "1");
  else fd.set("cwd", opts.cwd ?? "");
  for (const f of files) fd.append("files", f, f.name);
  try {
    // No content-type header: the browser sets the multipart boundary itself.
    const r = await fetch("/api/fs/upload", { method: "POST", headers: headers(token), body: fd });
    return await r.json();
  } catch {
    return { ok: false };
  }
}

export async function apiSearch(root: string, q: string, token: string | null): Promise<SearchResult> {
  try {
    const r = await fetch(`/api/fs/search?root=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}`, {
      headers: headers(token),
    });
    return await r.json();
  } catch {
    return { ok: false };
  }
}
