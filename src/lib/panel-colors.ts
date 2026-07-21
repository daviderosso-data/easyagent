// Preset accent colors for session panels (readable on light and dark).

export const PANEL_COLORS = [
  { id: "red", hex: "#e5484d" },
  { id: "orange", hex: "#f76b15" },
  { id: "amber", hex: "#f5a623" },
  { id: "green", hex: "#30a46c" },
  { id: "teal", hex: "#12a594" },
  { id: "blue", hex: "#0091ff" },
  { id: "violet", hex: "#8e4ec6" },
  { id: "pink", hex: "#d6409f" },
] as const;

export type PanelColorId = (typeof PANEL_COLORS)[number]["id"];

export function colorHex(id: string | undefined): string | null {
  return PANEL_COLORS.find((c) => c.id === id)?.hex ?? null;
}

/** Distinct default colors for orchestrator panels (i = panel index). */
export function autoColor(i: number): PanelColorId {
  const order: PanelColorId[] = ["amber", "blue", "green", "violet", "teal", "pink", "orange", "red"];
  return order[i % order.length];
}
