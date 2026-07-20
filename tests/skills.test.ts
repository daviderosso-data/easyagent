import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { parseSkillMd, listProjectSkills, toggleSkill, pluginNameFor, skillsQueryOptions } from "@/server/skills";
import { PROJECTS_ROOT } from "@/server/projects";

const WS = join(PROJECTS_ROOT, "skills-test");

const mkSkill = (root: string, sub: "skills" | "skills-off", name: string, fm = true) => {
  const dir = join(root, ".claude", sub, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    fm ? `---\nname: ${name}\ndescription: does ${name}\n---\n\nBody.\n` : "no frontmatter here"
  );
};

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });
});
afterAll(() => {
  rmSync(WS, { recursive: true, force: true });
});

describe("parseSkillMd", () => {
  it("reads name and description, stripping quotes", () => {
    expect(parseSkillMd('---\nname: "haiku"\ndescription: writes haiku\n---\nbody')).toEqual({
      name: "haiku",
      description: "writes haiku",
    });
  });
  it("handles missing frontmatter and missing fields", () => {
    expect(parseSkillMd("just text")).toEqual({ name: null, description: "" });
    expect(parseSkillMd("---\ndescription: only desc\n---\n").name).toBeNull();
  });
});

describe("listProjectSkills", () => {
  it("lists enabled and disabled skills with qualified commands", () => {
    mkSkill(WS, "skills", "haiku");
    mkSkill(WS, "skills-off", "notes");
    const r = listProjectSkills(WS)!;
    expect(r.projectRoot).toBe(WS);
    const byName = Object.fromEntries(r.skills.map((s) => [s.name, s]));
    expect(byName.haiku.enabled).toBe(true);
    expect(byName.haiku.command).toBe("haiku");
    expect(byName.notes.enabled).toBe(false);
    expect(byName.haiku.description).toBe("does haiku");
  });

  it("resolves role subfolders to the project root and skips invalid dirs", () => {
    mkSkill(WS, "skills", "valid");
    mkdirSync(join(WS, ".claude", "skills", "Invalid Name"), { recursive: true });
    mkdirSync(join(WS, "role-sub"), { recursive: true });
    const r = listProjectSkills(join(WS, "role-sub"))!;
    expect(r.projectRoot).toBe(WS);
    expect(r.skills.map((s) => s.name)).toEqual(["valid"]);
  });

  it("returns null outside the projects root", () => {
    expect(listProjectSkills("/tmp")).toBeNull();
  });
});

describe("toggleSkill", () => {
  it("moves a skill between skills/ and skills-off/ round-trip", () => {
    mkSkill(WS, "skills", "haiku");
    expect(toggleSkill(WS, "haiku", false).ok).toBe(true);
    expect(existsSync(join(WS, ".claude", "skills-off", "haiku", "SKILL.md"))).toBe(true);
    expect(toggleSkill(WS, "haiku", true).ok).toBe(true);
    expect(existsSync(join(WS, ".claude", "skills", "haiku", "SKILL.md"))).toBe(true);
  });

  it("errors on missing skill, collision, and bad names", () => {
    expect(toggleSkill(WS, "ghost", false).error).toBe("not-found");
    mkSkill(WS, "skills", "dup");
    mkSkill(WS, "skills-off", "dup");
    expect(toggleSkill(WS, "dup", false).error).toBe("exists");
    expect(toggleSkill(WS, "../escape", false).error).toBe("bad-request");
  });
});

describe("skillsQueryOptions", () => {
  it("returns a plugin config only when enabled skills exist, and writes the manifest", () => {
    expect(skillsQueryOptions(WS)).toEqual({});
    mkSkill(WS, "skills", "haiku");
    const opts = skillsQueryOptions(WS) as { plugins?: { type: string; path: string; skipMcpDiscovery: boolean }[] };
    expect(opts.plugins).toHaveLength(1);
    expect(opts.plugins![0]).toEqual({ type: "local", path: join(WS, ".claude"), skipMcpDiscovery: true });
    expect(existsSync(join(WS, ".claude", ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("sanitizes the plugin name from the folder", () => {
    expect(pluginNameFor("/x/Demo Sito!")).toBe("demo-sito");
    expect(pluginNameFor("/x/___")).toBe("project");
  });
});
