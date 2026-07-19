import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PreviewPlan =
  | { kind: "node"; script: "dev" | "start"; needsInstall: boolean }
  | { kind: "static" }
  | { kind: "none" };

export function detectPreview(projectRoot: string): PreviewPlan {
  const pkgPath = join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const scripts = pkg?.scripts ?? {};
      const script = typeof scripts.dev === "string" ? "dev" : typeof scripts.start === "string" ? "start" : null;
      if (script) {
        const hasDeps =
          Object.keys(pkg?.dependencies ?? {}).length > 0 || Object.keys(pkg?.devDependencies ?? {}).length > 0;
        const needsInstall = hasDeps && !existsSync(join(projectRoot, "node_modules"));
        return { kind: "node", script, needsInstall };
      }
    } catch {
      /* malformed package.json → fall through */
    }
  }
  if (existsSync(join(projectRoot, "index.html"))) return { kind: "static" };
  return { kind: "none" };
}
