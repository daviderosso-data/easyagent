// Client-safe list of project starter templates. The actual file contents live
// server-side in src/server/project-templates.ts (validated against this list).

export const TEMPLATE_IDS = ["empty", "web", "node", "python"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** i18n key for each template's label. */
export const TEMPLATE_LABEL_KEY: Record<TemplateId, "tplEmpty" | "tplWeb" | "tplNode" | "tplPython"> = {
  empty: "tplEmpty",
  web: "tplWeb",
  node: "tplNode",
  python: "tplPython",
};
