import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, PROFILES, type AppSettings } from "@/lib/settings";
import { migrateLegacyDataOnce } from "@/server/migrate-legacy";

migrateLegacyDataOnce();

const DIR = join(homedir(), ".easyagent");
const FILE = join(DIR, "settings.json");

export function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
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
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(settings, null, 2), "utf8");
}

export const SETTINGS_DIR = DIR;
