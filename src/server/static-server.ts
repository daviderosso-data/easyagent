import { createServer } from "node:http";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

// Serves a project folder on its OWN loopback port. A separate origin is a
// security requirement: project HTML/JS must never run on the app's origin,
// where it could read the session token via same-origin /api calls.

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

export async function startStaticServer(rootDir: string): Promise<{ close: () => void; port: number; url: string }> {
  const realRoot = realpathSync(rootDir);

  const server = createServer((req, res) => {
    const fail = (code: number) => {
      res.writeHead(code, { "content-type": "text/plain" });
      res.end(code === 404 ? "Not found" : "Bad request");
    };
    try {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      } catch {
        return fail(400);
      }
      if (pathname.includes("\0")) return fail(400);

      let abs = normalize(join(realRoot, pathname));
      if (abs !== realRoot && !abs.startsWith(realRoot + sep)) return fail(404);

      let st = statSync(abs, { throwIfNoEntry: false });
      if (st?.isDirectory()) {
        abs = join(abs, "index.html");
        st = statSync(abs, { throwIfNoEntry: false });
      }
      if (!st?.isFile()) return fail(404);

      // Symlink-safe re-check on the resolved file.
      const real = realpathSync(abs);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) return fail(404);

      res.writeHead(200, {
        "content-type": MIME[extname(real).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      createReadStream(real).pipe(res);
    } catch {
      fail(404);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    close: () => {
      try {
        server.close();
        server.closeAllConnections?.();
      } catch {
        /* best effort */
      }
    },
    port,
    url: `http://127.0.0.1:${port}`,
  };
}
