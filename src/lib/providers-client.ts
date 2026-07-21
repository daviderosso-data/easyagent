// Client-safe mirror of the /api/providers payload (no server imports).

export interface ProviderCapabilitiesInfo {
  approvals: boolean;
  mcp: boolean;
  skills: boolean;
  resume: boolean;
  effort: boolean;
  slashCommands: boolean;
  rateLimits: boolean;
}

export interface ProviderModelInfo {
  id: string | null;
  label: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  capabilities: ProviderCapabilitiesInfo;
  models: ProviderModelInfo[];
  status: { installed: boolean; loggedIn: boolean | null };
  hasAccount: boolean;
}

export const DEFAULT_PROVIDER_ID = "claude";
