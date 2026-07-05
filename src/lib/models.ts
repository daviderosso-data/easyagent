// Client-safe model + reasoning-effort catalogue for the per-chat selectors.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelOption {
  id: string | null; // null = use Claude Code's default
  label: string;
}

export const MODELS: ModelOption[] = [
  { id: null, label: "Default" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-fable-5", label: "Fable 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export const EFFORTS: { id: Effort | null }[] = [
  { id: null },
  { id: "low" },
  { id: "medium" },
  { id: "high" },
  { id: "xhigh" },
  { id: "max" },
];
