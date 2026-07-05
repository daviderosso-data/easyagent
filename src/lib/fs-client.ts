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
  name?: string;
  content?: string;
  tooBig?: boolean;
}

function headers(token: string | null): Record<string, string> {
  return token ? { "x-ccw-token": token } : {};
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

export async function apiMkdir(
  parent: string,
  name: string,
  token: string | null,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const r = await fetch("/api/fs/mkdir", {
      method: "POST",
      headers: { ...headers(token), "content-type": "application/json" },
      body: JSON.stringify({ parent, name }),
    });
    return await r.json();
  } catch {
    return { ok: false };
  }
}
