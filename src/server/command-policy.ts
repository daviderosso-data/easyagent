import { homedir, tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import type { SecurityConfig } from "@/lib/settings";

/**
 * Detects the intrinsic risk of each tool call, then maps it to a level using
 * the active SecurityConfig. Shared by the PreToolUse hook (block -> deny,
 * red -> ask) and canUseTool (UI tier). Text is localized elsewhere (i18n-server).
 *
 * NOTE: Bash string matching is defense-in-depth, not a perfect gate — the OS
 * sandbox is the authoritative enforcement for Bash filesystem/network.
 */
export type RiskLevel = "block" | "red" | "normal";
export type Severity =
  | "catastrophic" | "secret" | "escape" | "install" | "network"
  | "broaddelete" | "perms" | "kill" | "mcp" | "bundle" | "none";

export interface Classification {
  level: RiskLevel;
  severity: Severity;
}

const HOME = homedir();
const SYSTEM_PATHS = ["/etc", "/usr", "/bin", "/sbin", "/System", "/Library", "/var", "/boot", "/root"];
const SHELL_PROFILES = [
  ".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".bash_login", ".profile",
].map((f) => `${HOME}/${f}`);
const SECRET_DIRS = [`${HOME}/.ssh`, `${HOME}/.aws`, `${HOME}/.config/gcloud`, `${HOME}/.gnupg`, `${HOME}/.kube`];
const SECRET_FILES = [
  `${HOME}/.claude/.credentials.json`, `${HOME}/.netrc`, `${HOME}/.npmrc`,
  `${HOME}/.docker/config.json`, `${HOME}/.git-credentials`, `${HOME}/.pgpass`,
];
const SECRET_REFS = [
  ".ssh", ".aws", ".config/gcloud", ".gnupg", ".claude/.credentials", ".docker/config", ".kube/config",
  ".netrc", ".npmrc", ".git-credentials", ".pgpass",
];
/** Basenames that are secrets in ANY directory (not just $HOME). */
const SECRET_BASENAMES = new Set([".netrc", ".npmrc", ".git-credentials", ".pgpass"]);
/** .env variants that are templates, not secrets (commonly committed). */
const ENV_TEMPLATE_RE = /\.(example|sample|template|dist)$/;
/** A ".env" / ".env.local" path token inside a shell command. The leading
 *  [^\w.] excludes "process.env" / "import.meta.env"; the trailing guard
 *  makes the whole token match so ".env.example" can be exempted. */
const ENV_TOKEN_RE = /(^|[^\w.])(\.env(?:\.[\w-]+)*)(?![\w.])/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function resolvePath(p: string, cwd: string): string {
  let s = (p || "").trim();
  if (s === "~") s = HOME;
  else if (s.startsWith("~/")) s = HOME + s.slice(1);
  return resolve(cwd || HOME, s);
}
function isWithin(p: string, root: string): boolean {
  const r = resolve(root);
  return p === r || p.startsWith(r + sep);
}
function pathIsSecret(p: string): boolean {
  return SECRET_FILES.includes(p) || SHELL_PROFILES.includes(p) || SECRET_DIRS.some((d) => p === d || p.startsWith(d + sep));
}
/** Secret files identified by basename alone, in any directory: .env variants
 *  (except committed templates like .env.example) and credential dotfiles. */
function basenameIsSecret(p: string): boolean {
  const base = p.split(sep).pop() ?? "";
  if (SECRET_BASENAMES.has(base)) return true;
  return /^\.env(\.[\w-]+)*$/.test(base) && !ENV_TEMPLATE_RE.test(base);
}
function pathIsSystem(p: string): boolean {
  return SYSTEM_PATHS.some((d) => p === d || p.startsWith(d + sep));
}

/* ---------- Bash severity detection ---------- */

function isCatastrophicRm(c: string): boolean {
  if (!/\brm\b/.test(c)) return false;
  if (!/\brm\b[^|]*?(-[a-z]*r|--recursive|--no-preserve-root)/.test(c)) return false;
  const seg = /\brm\b[^|;&]*/.exec(c)?.[0] ?? c;
  if (/\s(\/|~|\$HOME|\$\{HOME\})(\s|;|$)/.test(seg)) return true;
  if (/\s\/\*/.test(seg)) return true;
  if (SYSTEM_PATHS.some((p) => new RegExp(`\\s${escapeRe(p)}(\\b|/)`).test(seg))) return true;
  if (new RegExp(`\\s${escapeRe(HOME)}(\\s|/?$|/\\*)`).test(seg)) return true;
  return false;
}
function writesToProtectedPath(c: string): boolean {
  if (!/(>>?\s|(^|\s)(tee|cp|mv|ln|install|rsync)\b)/.test(c)) return false;
  const targets = [...SYSTEM_PATHS, ...SHELL_PROFILES, `${HOME}/.ssh`];
  return targets.some((p) => c.includes(p) || c.includes(p.replace(HOME, "~")));
}
/** Secret basenames a shell glob could expand onto, for the check below. */
const SECRET_TARGETS = [".env", ".env.local", ".env.production", ".netrc", ".npmrc", ".git-credentials", ".pgpass"];

/** A glob that could expand onto a secret — `cat .e*`, `cat .*`, `head *env*`.
 *  Naming the file is caught by readsSecret(); this catches spelling it with a
 *  wildcard instead, which is the cheapest way around a string matcher.
 *  Deliberately NOT extended to recursive readers (`grep -r`): those are far
 *  too common to prompt on, and the sandbox's denyRead covers them properly. */
function globCouldHitSecret(c: string): boolean {
  for (const raw of c.split(/[\s;|&<>()]+/)) {
    const tok = raw.replace(/^['"]|['"]$/g, "");
    if (!tok || !/[*?]/.test(tok) || tok.startsWith("-")) continue;
    const base = tok.split("/").pop() ?? "";
    // Only dot-globs and *env*-style patterns; plain "*.ts" can't reach a dotfile.
    if (!base.startsWith(".") && !/env/i.test(base)) continue;
    const re = new RegExp(`^${base.split("*").map((p) => p.split("?").map(escapeRe).join(".")).join(".*")}$`);
    if (SECRET_TARGETS.some((s) => re.test(s))) return true;
  }
  return false;
}

/** Packing or copying a whole tree sweeps up secrets without ever naming one
 *  (`tar czf /tmp/x.tgz .`, `cp -r . /tmp/out`). Legitimate often enough that
 *  it asks rather than blocks. */
function bundlesDirectory(c: string): boolean {
  // Only CREATING an archive packs things up; extracting or listing one is
  // harmless. tar's mode letter may come with or without a dash ("tar czf").
  if (/\b(tar|jar)\s+(--create\b|-?[a-z]*c[a-z]*\b)/.test(c)) return true;
  if (/\bzip\b/.test(c)) return true; // "unzip" has no word boundary before zip
  if (/\b7z\s+a\b/.test(c)) return true;
  if (/\b(cp|rsync)\b[^\n]*(-[a-zA-Z]*[ra]|--recursive|--archive)\b/.test(c)) return true;
  return false;
}

function readsSecret(c: string): boolean {
  if (/security\s+find-(generic|internet)-password/.test(c)) return true;
  if (globCouldHitSecret(c)) return true;
  // Any Bash mention of a .env file counts: a string matcher can't tell reads
  // from writes ("cat .env | curl…"), and the Write tool remains available
  // for legitimately creating env files.
  for (const m of c.matchAll(ENV_TOKEN_RE)) {
    if (!ENV_TEMPLATE_RE.test(m[2])) return true;
  }
  return SECRET_REFS.some((s) => c.includes(s));
}
function isServiceInstall(c: string): boolean {
  return /\bcrontab\b|\blaunchctl\s+(load|bootstrap|enable)|\bsystemctl\s+(enable|--user|start)|\bchsh\b|\bscutil\b/.test(c);
}
function isDiskOp(c: string): boolean {
  return (/\bdd\b[^\n]*\bof=\/dev\//.test(c) || /\bmkfs(\.\w+)?\b/.test(c) || /\bnewfs\b/.test(c) ||
    /diskutil\s+(erase|reformat|partitiondisk|apfs\s+erase)/i.test(c) || /\bfdisk\b/.test(c));
}
function isForkBomb(c: string): boolean {
  return /:\(\)\{:\|:&\};:/.test(c.replace(/\s/g, "")) || /:\s*\(\)\s*\{[^}]*:\s*\|\s*:/.test(c);
}
function isInstall(c: string): boolean {
  return (
    /\b(npm|pnpm|yarn|bun)\b[^\n]*\b(install|add|remove|uninstall|ci|dlx)\b/.test(c) || /\bnpx\b/.test(c) ||
    /\bpip[23]?\b[^\n]*\b(install|uninstall)\b/.test(c) || /\bpipx\b/.test(c) ||
    /\bbrew\b[^\n]*\b(install|uninstall|reinstall|remove|tap)\b/.test(c) ||
    /\bapt(-get)?\b[^\n]*\b(install|remove|purge)\b/.test(c) ||
    /\b(dnf|yum|pacman|zypper|apk)\b[^\n]*\b(install|remove|erase|-S)\b/.test(c) ||
    /\bgem\s+install\b|\bcargo\s+install\b|\bgo\s+install\b/.test(c) ||
    /\bsoftwareupdate\b|\bmas\s+(install|purchase)\b/.test(c) ||
    /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(c) || /\b(sh|bash|zsh)\b\s+<\(\s*(curl|wget)/.test(c)
  );
}
function isNetwork(c: string): boolean {
  return /\b(curl|wget|nc|ncat|telnet|ftp|sftp)\b/.test(c) || /\b(ssh|scp)\b/.test(c) ||
    /\brsync\b[^\n]*:/.test(c) || /\bgit\s+(push|clone|pull|fetch|remote\s+add)\b/.test(c);
}
function isBroadDelete(c: string): boolean {
  return /\brm\b[^\n]*(-[a-z]*r|--recursive)/.test(c) || /\brm\b[^\n]*[*?]/.test(c) ||
    /\bgit\s+reset\s+--hard\b/.test(c) || /\bgit\s+clean\s+-[a-z]*f/.test(c) ||
    /\bfind\b[^\n]*(-delete\b|-exec\s+rm)/.test(c) || /\b(shred|trash)\b/.test(c) || /\btruncate\b[^\n]*-s\s*0/.test(c);
}
function writesOutsideCwd(c: string, cwd: string): boolean {
  const re = /(?:>>?|(?:^|\s)(?:tee|cp|mv|dd)\s+(?:-\S+\s+)*)\s*['"]?([~/][^\s'";|&>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(c))) {
    const abs = resolvePath(m[1], cwd);
    if (isWithin(abs, cwd)) continue;
    if (abs.startsWith("/tmp") || isWithin(abs, tmpdir())) continue;
    return true;
  }
  return false;
}

function severityBash(c: string, cwd: string): Severity {
  if (/(^|[\s;&|(<])(sudo|doas)(\s|$)/.test(c) || /(^|[\s;&|(])su\s+/.test(c)) return "catastrophic";
  if (isDiskOp(c) || isForkBomb(c) || isCatastrophicRm(c) || writesToProtectedPath(c) || isServiceInstall(c)) return "catastrophic";
  if (readsSecret(c)) return "secret";
  if (isInstall(c)) return "install";
  if (isNetwork(c)) return "network";
  if (isBroadDelete(c)) return "broaddelete";
  if (bundlesDirectory(c)) return "bundle";
  if (writesOutsideCwd(c, cwd)) return "escape";
  if (/\b(chmod|chown|chgrp)\b/.test(c)) return "perms";
  if (/\b(kill|killall|pkill)\b/.test(c)) return "kill";
  return "none";
}

/* ---------- Level policy ---------- */

export function levelFor(sev: Severity, cfg: SecurityConfig): RiskLevel {
  switch (sev) {
    case "catastrophic": return cfg.blockCatastrophic ? "block" : "normal";
    case "secret": return cfg.blockSecrets ? "block" : "normal";
    case "escape": return cfg.confineToFolder ? "block" : "normal";
    case "install":
    case "network":
      return cfg.installNetwork === "block" ? "block" : cfg.installNetwork === "red" ? "red" : "normal";
    case "broaddelete":
    case "perms":
    case "kill":
      return cfg.blockCatastrophic ? "red" : "normal";
    // Asks rather than blocks: packing a folder is normal work, and the file
    // it might sweep up is already unreadable when the sandbox is available.
    case "bundle":
      return cfg.blockSecrets ? "red" : "normal";
    case "mcp":
      // Defense in depth: under Locked the primary lever is that no mcpServers
      // are passed to the SDK at all; this makes a stray MCP call an outright
      // block. Elsewhere it is "normal" but autoAllows() still forces a prompt.
      return cfg.profile === "locked" ? "block" : "normal";
    default:
      return "normal";
  }
}

export type Classify = (toolName: string, input: Record<string, unknown>) => Classification;

export function makeClassifier(cwd: string, cfg: SecurityConfig): Classify {
  return (toolName, input) => {
    let sev: Severity = "none";
    switch (toolName) {
      case "Bash":
      case "BashOutput":
        sev = severityBash(String(input.command ?? ""), cwd);
        break;
      case "Write":
      case "Edit":
      case "MultiEdit":
      case "NotebookEdit": {
        const abs = resolvePath(String(input.file_path ?? input.notebook_path ?? ""), cwd);
        sev = pathIsSecret(abs) ? "secret" : pathIsSystem(abs) ? "catastrophic" : !isWithin(abs, cwd) ? "escape" : "none";
        break;
      }
      case "Read": {
        const abs = resolvePath(String(input.file_path ?? ""), cwd);
        sev = pathIsSecret(abs) || basenameIsSecret(abs) ? "secret" : "none";
        break;
      }
      case "Grep":
      case "Glob": {
        // These read file contents/names too; keep them out of secret dirs.
        const abs = resolvePath(String(input.path ?? cwd), cwd);
        sev = pathIsSecret(abs) || basenameIsSecret(abs) ? "secret" : "none";
        break;
      }
      case "WebFetch":
      case "WebSearch":
        sev = "network";
        break;
      default:
        // External MCP tools (mcp__server__tool) can do anything — never let
        // them fall through as harmless unknowns.
        if (toolName.startsWith("mcp__")) sev = "mcp";
        break;
    }
    return { level: levelFor(sev, cfg), severity: sev };
  };
}

/* ---------- Declarative deny/ask rules (config-gated backup) ---------- */

const CATASTROPHIC_DENY = [
  "Bash(sudo:*)", "Bash(doas:*)", "Bash(su:*)", "Bash(dd:*)", "Bash(mkfs:*)",
  "Bash(diskutil:*)", "Bash(fdisk:*)", "Bash(chsh:*)", "Bash(crontab:*)", "Bash(launchctl:*)",
  "Write(/etc/**)", "Edit(/etc/**)", "Write(/usr/**)", "Edit(/usr/**)",
  "Write(~/.ssh/**)", "Edit(~/.ssh/**)", "Write(~/.zshrc)", "Edit(~/.zshrc)", "Write(~/.bashrc)", "Edit(~/.bashrc)",
];
const SECRET_DENY = [
  "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.gnupg/**)", "Read(~/.config/gcloud/**)",
  "Read(~/.kube/**)", "Read(~/.claude/.credentials.json)", "Read(~/.netrc)", "Read(~/.npmrc)",
  "Read(~/.docker/config.json)", "Read(~/.git-credentials)", "Read(~/.pgpass)",
  "Read(./.env)", "Read(./.env.*)", "Read(**/.env)", "Read(**/.env.*)",
];
const INSTALL_NETWORK = [
  "Bash(npm install:*)", "Bash(npm uninstall:*)", "Bash(npm add:*)", "Bash(npx:*)",
  "Bash(pnpm add:*)", "Bash(yarn add:*)", "Bash(pip install:*)", "Bash(brew:*)", "Bash(apt:*)",
  "Bash(apt-get:*)", "Bash(gem install:*)", "Bash(cargo install:*)",
  "Bash(curl:*)", "Bash(wget:*)", "Bash(ssh:*)", "Bash(scp:*)", "Bash(nc:*)", "Bash(git push:*)",
];

export function buildRules(cfg: SecurityConfig): { deny: string[]; ask: string[] } {
  const deny: string[] = [];
  const ask: string[] = [];
  if (cfg.blockCatastrophic) deny.push(...CATASTROPHIC_DENY);
  if (cfg.blockSecrets) deny.push(...SECRET_DENY);
  if (cfg.installNetwork === "block") deny.push(...INSTALL_NETWORK);
  else if (cfg.installNetwork === "red") ask.push(...INSTALL_NETWORK);
  return { deny, ask };
}
