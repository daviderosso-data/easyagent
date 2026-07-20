// Client-safe MCP helpers (no imports).

/** Parse "mcp__server__tool_name" → {server, tool}. Null for non-MCP tools.
 *  Splits at the FIRST "__" after the prefix — tool names may contain "__". */
export function parseMcpTool(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const rest = toolName.slice(5);
  const i = rest.indexOf("__");
  if (i <= 0) return null;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}
