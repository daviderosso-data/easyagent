// Shared, client-safe settings model (no server-only imports).

export type Lang = "en" | "it";
export type Theme = "system" | "light" | "dark";
export type SecurityProfile = "locked" | "standard" | "open";

/** How install/network commands are treated. */
export type InstallNetworkPolicy = "block" | "red" | "normal" | "off";
/** Default permission behavior → SDK permissionMode. */
export type Behavior = "ask" | "auto" | "open";

export interface SecurityConfig {
  profile: SecurityProfile;
  /** OS sandbox (filesystem/credential confinement). */
  sandbox: boolean;
  /** Block catastrophic commands (sudo, rm -rf /, disk format, system writes…). */
  blockCatastrophic: boolean;
  /** Block reading secrets (~/.ssh, ~/.aws, .env…). */
  blockSecrets: boolean;
  /** Block writes outside the project folder. */
  confineToFolder: boolean;
  /** How to treat software installs and internet access. */
  installNetwork: InstallNetworkPolicy;
  /** ask = confirm edits/commands; auto = auto-apply edits; open = never ask. */
  behavior: Behavior;
}

export interface AppSettings {
  lang: Lang;
  theme: Theme;
  /** null = use Claude Code's default model. */
  model: string | null;
  security: SecurityConfig;
  /** Last-used project folder. */
  cwd: string | null;
  /** Desktop notifications when the app is in the background. */
  notifications: boolean;
  /** Serve over HTTPS with the local self-signed cert (applies on restart). */
  https: boolean;
  /** P7.1 — listen on every interface so a phone can reach the app. Requires
   *  an app password and https; applies on restart. */
  remote: boolean;
}

/** The three presets. Users can then tweak individual toggles. */
export const PROFILES: Record<SecurityProfile, SecurityConfig> = {
  locked: {
    profile: "locked",
    sandbox: true,
    blockCatastrophic: true,
    blockSecrets: true,
    confineToFolder: true,
    installNetwork: "red",
    behavior: "ask",
  },
  standard: {
    profile: "standard",
    sandbox: true,
    blockCatastrophic: true,
    blockSecrets: true,
    confineToFolder: true,
    installNetwork: "normal",
    behavior: "auto",
  },
  open: {
    profile: "open",
    sandbox: false,
    blockCatastrophic: false,
    blockSecrets: false,
    confineToFolder: false,
    installNetwork: "off",
    behavior: "open",
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  lang: "en",
  theme: "system",
  model: null,
  security: PROFILES.locked,
  cwd: null,
  notifications: false,
  https: false,
  remote: false,
};

/** Config used for orchestration turns: fully autonomous (no approval prompts,
 *  so the multi-agent loop never stalls) BUT keeps the hard safety floor —
 *  sandbox on, and catastrophic commands / secret reads are still blocked. */
export const ORCHESTRATION_CONFIG: SecurityConfig = {
  profile: "standard",
  sandbox: true,
  blockCatastrophic: true,
  blockSecrets: true,
  confineToFolder: false,
  installNetwork: "off",
  behavior: "open",
};

/** Does the current config exactly match one of the presets? (else "custom"). */
export function detectProfile(c: SecurityConfig): SecurityProfile | "custom" {
  for (const key of ["locked", "standard", "open"] as SecurityProfile[]) {
    const p = PROFILES[key];
    if (
      p.sandbox === c.sandbox &&
      p.blockCatastrophic === c.blockCatastrophic &&
      p.blockSecrets === c.blockSecrets &&
      p.confineToFolder === c.confineToFolder &&
      p.installNetwork === c.installNetwork &&
      p.behavior === c.behavior
    ) {
      return key;
    }
  }
  return "custom";
}
