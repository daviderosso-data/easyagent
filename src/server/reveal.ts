import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { withinProjectsRoot } from "@/server/projects";

/** Open a project folder in the OS file manager (Finder / Explorer / xdg).
 *  Confined to the projects root; spawns with an args array (no shell). */
export function revealInOS(path: unknown): boolean {
  if (!withinProjectsRoot(path)) return false;
  const abs = resolve(path as string);
  try {
    if (!statSync(abs).isDirectory()) return false;
  } catch {
    return false;
  }
  let cmd: string;
  if (process.platform === "darwin") cmd = "open";
  else if (process.platform === "win32") cmd = "explorer";
  else cmd = "xdg-open";
  try {
    const child = spawn(cmd, [abs], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
