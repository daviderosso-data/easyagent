import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, PROFILES, type AppSettings } from "@/lib/settings";
import { migrateLegacyDataOnce } from "@/server/migrate-legacy";

migrateLegacyDataOnce();

// EASYAGENT_DIR override keeps tests and server.mjs consistent (P7). Resolved
// per call, not at import time, so a test that sets it after this module loads
// still gets an isolated directory.
const DIR = process.env.EASYAGENT_DIR || join(homedir(), ".easyagent");
const dir = () => process.env.EASYAGENT_DIR || join(homedir(), ".easyagent");
const file = () => join(dir(), "settings.json");

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(file(), "utf8"));
    // Merge with defaults so missing keys are filled and security is complete.
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      security: { ...PROFILES.locked, ...(raw.security ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(settings, null, 2), "utf8");
}

export const SETTINGS_DIR = DIR;
