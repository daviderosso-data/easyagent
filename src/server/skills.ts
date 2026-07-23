import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { projectRootFor } from "@/server/snapshots";
import { realWithinProjectsRoot } from "@/server/projects";

// Per-project skills stored in <project>/.claude/skills/<name>/SKILL.md.
//
// Probe outcome (SDK 0.3.201, 2026-07-20): with settingSources: [] the CLI
// does NOT auto-discover project .claude/skills — but loading that folder as a
// local plugin works, and a .claude-plugin/plugin.json manifest names it, so
// skills surface as "<plugin>:<skill>" slash commands (discovery mode: plugin).
// Enabled = dir in skills/; disabled = dir moved to skills-off/. We never pass
// the SDK `skills` option (it would filter out bundled skills too).

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  dir: string;
  file: string;
  /** Slash command as the palette lists it (probe-verified: the CLI exposes
   *  plugin skills under their SHORT name in supportedCommands). */
  command: string;
}

/** Minimal frontmatter parse: leading --- block with name:/description: lines. */
export function parseSkillMd(content: string): { name: string | null; description: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return { name: null, description: "" };
  const pick = (key: string): string => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(m[1]);
    return (line?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  };
  return { name: pick("name") || null, description: pick("description") };
}

/** Plugin name shown in the palette prefix — derived from the project folder. */
export function pluginNameFor(projectRoot: string): string {
  const slug = basename(projectRoot)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function scanDir(dir: string, enabled: boolean, command: (name: string) => string): SkillInfo[] {
  if (!existsSync(dir)) return [];
  const out: SkillInfo[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SKILL_NAME_RE.test(entry.name)) continue;
    const file = join(dir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    let meta = { name: null as string | null, description: "" };
    try {
      meta = parseSkillMd(readFileSync(file, "utf8"));
    } catch {
      /* unreadable → defaults */
    }
    const name = meta.name && SKILL_NAME_RE.test(meta.name) ? meta.name : entry.name;
    out.push({ name, description: meta.description, enabled, dir: join(dir, entry.name), file, command: command(name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listProjectSkills(cwd: string): { projectRoot: string; skills: SkillInfo[] } | null {
  const projectRoot = projectRootFor(cwd);
  if (!projectRoot) return null;
  const cmd = (n: string) => n;
  return {
    projectRoot,
    skills: [
      ...scanDir(join(projectRoot, ".claude", "skills"), true, cmd),
      ...scanDir(join(projectRoot, ".claude", "skills-off"), false, cmd),
    ],
  };
}

export function toggleSkill(cwd: string, dirName: string, enabled: boolean): { ok: boolean; error?: string } {
  const projectRoot = projectRootFor(cwd);
  if (!projectRoot || !SKILL_NAME_RE.test(dirName)) return { ok: false, error: "bad-request" };
  const from = join(projectRoot, ".claude", enabled ? "skills-off" : "skills", dirName);
  const to = join(projectRoot, ".claude", enabled ? "skills" : "skills-off", dirName);
  if (!realWithinProjectsRoot(from)) return { ok: false, error: "bad-request" };
  if (!existsSync(from)) return { ok: false, error: "not-found" };
  if (existsSync(to)) return { ok: false, error: "exists" };
  try {
    mkdirSync(join(projectRoot, ".claude", enabled ? "skills" : "skills-off"), { recursive: true });
    renameSync(from, to);
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/* ---- Built-in preset skills (P6.9.9) ---- */
// One-click installs from the Skills panel. Content is English (it instructs
// the agent, not the user).
const PRESET_SKILLS: Record<string, { md: string }> = {
  "image-gen": {
    md: `---
name: image-gen
description: Generate or edit images (PNG) from a text description using the Codex CLI's built-in image tool on the user's ChatGPT subscription. Use when the user asks to create, draw or generate an image, icon, logo, illustration or picture.
---

# Generate images via Codex

Run this from the project folder (Bash), with a rich, specific description
(subject, style, colors, background) and a relative output path:

    codex exec --skip-git-repo-check --sandbox workspace-write -m gpt-5.6-luna "Generate an image of <detailed description> and save it as <relative/path.png> in the current directory."

- If \`codex\` is not on PATH, replace it with \`npx --yes @openai/codex@latest\`.
- When done, tell the user the file path of the image.
- Requires the Codex CLI signed in to ChatGPT (easyagent Settings → Other engines).
- If the command fails because of sandbox or permission limits, do not retry:
  tell the user to switch this chat's engine to Codex (header dropdown) and ask
  for the image there — Codex generates images natively.
`,
  },
};

export function presetSkillIds(cwd: string): { id: string; installed: boolean }[] {
  const projectRoot = projectRootFor(cwd);
  if (!projectRoot) return [];
  return Object.keys(PRESET_SKILLS).map((id) => ({
    id,
    installed:
      existsSync(join(projectRoot, ".claude", "skills", id)) || existsSync(join(projectRoot, ".claude", "skills-off", id)),
  }));
}

export function installPresetSkill(cwd: string, id: string): { ok: boolean; error?: string } {
  const preset = PRESET_SKILLS[id];
  const projectRoot = projectRootFor(cwd);
  if (!preset || !projectRoot) return { ok: false, error: "bad-request" };
  const dir = join(projectRoot, ".claude", "skills", id);
  if (existsSync(dir) || existsSync(join(projectRoot, ".claude", "skills-off", id))) return { ok: false, error: "exists" };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), preset.md, "utf8");
    ensurePluginManifest(projectRoot);
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** Ensures the plugin manifest exists so skills get a friendly qualified name. */
function ensurePluginManifest(projectRoot: string): void {
  const dir = join(projectRoot, ".claude", ".claude-plugin");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: pluginNameFor(projectRoot) }), "utf8");
  } catch {
    /* best effort */
  }
}

/** Extra query() options that load the project's enabled skills (probe-verified
 *  plugin fallback). Empty when the project has no skills at all. */
export function skillsQueryOptions(cwd: string): Record<string, unknown> {
  const projectRoot = projectRootFor(cwd);
  if (!projectRoot) return {};
  const skillsDir = join(projectRoot, ".claude", "skills");
  if (!existsSync(skillsDir) || readdirSync(skillsDir).length === 0) return {};
  ensurePluginManifest(projectRoot);
  return { plugins: [{ type: "local", path: join(projectRoot, ".claude"), skipMcpDiscovery: true }] };
}
