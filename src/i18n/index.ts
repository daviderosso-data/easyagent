"use client";

import { useAgent } from "@/store/agent";
import { messages, type MsgKey } from "@/i18n/messages";
import type { Lang } from "@/lib/settings";
import { parseMcpTool } from "@/lib/mcp-shared";

export function useT(): (k: MsgKey) => string {
  const lang = useAgent((s) => s.lang);
  return (k) => messages[lang][k] ?? messages.en[k] ?? k;
}

export function useLang(): Lang {
  return useAgent((s) => s.lang);
}

function basename(p: unknown): string {
  if (typeof p !== "string") return "";
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

const SEVERITY_REASON: Record<string, MsgKey> = {
  catastrophic: "reasonCatastrophic",
  secret: "reasonSecret",
  escape: "reasonEscape",
  install: "reasonInstall",
  network: "reasonNetwork",
  broaddelete: "reasonBroaddelete",
  perms: "reasonPerms",
  kill: "reasonKill",
  mcp: "reasonMcp",
  bundle: "reasonBundle",
};

export function riskReason(severity: string, lang: Lang): string | null {
  const key = SEVERITY_REASON[severity];
  return key ? messages[lang][key] : null;
}

export function describeTool(toolName: string, input: Record<string, unknown>, lang: Lang): string {
  const it = lang === "it";
  const f = basename(input.file_path ?? input.notebook_path);
  switch (toolName) {
    case "Write":
      return it ? `Claude vuole creare/scrivere il file «${f}».` : `Claude wants to create/write the file "${f}".`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return it ? `Claude vuole modificare il file «${f}».` : `Claude wants to edit the file "${f}".`;
    case "Bash": {
      const c = String(input.command ?? "");
      return it ? `Claude vuole eseguire un comando:\n${c}` : `Claude wants to run a command:\n${c}`;
    }
    case "WebFetch":
      return it ? `Claude vuole aprire: ${String(input.url ?? "")}` : `Claude wants to open: ${String(input.url ?? "")}`;
    case "WebSearch":
      return it ? `Claude vuole cercare sul web: «${String(input.query ?? "")}».` : `Claude wants to search the web: "${String(input.query ?? "")}".`;
    default: {
      const mcp = parseMcpTool(toolName);
      if (mcp) {
        return it
          ? `Claude vuole usare il collegamento «${mcp.server}»: ${mcp.tool}.`
          : `Claude wants to use the "${mcp.server}" connection: ${mcp.tool}.`;
      }
      return it ? `Claude vuole usare lo strumento «${toolName}».` : `Claude wants to use the "${toolName}" tool.`;
    }
  }
}

export function labelTool(toolName: string, input: Record<string, unknown>, lang: Lang): string {
  const it = lang === "it";
  const f = basename(input.file_path);
  switch (toolName) {
    case "Read":
      return it ? `Sto leggendo ${f}` : `Reading ${f}`;
    case "Glob":
      return it ? `Cerco file: ${String(input.pattern ?? "")}` : `Finding files: ${String(input.pattern ?? "")}`;
    case "Grep":
      return it ? `Cerco nel codice: ${String(input.pattern ?? "")}` : `Searching code: ${String(input.pattern ?? "")}`;
    case "LS":
      return it ? "Elenco la cartella" : "Listing the folder";
    case "Write":
      return it ? `Creo ${f}` : `Creating ${f}`;
    case "Edit":
    case "MultiEdit":
      return it ? `Modifico ${f}` : `Editing ${f}`;
    case "Bash":
      return it ? `Eseguo: ${String(input.command ?? "")}` : `Running: ${String(input.command ?? "")}`;
    case "TodoWrite":
      return it ? "Aggiorno la lista di cose da fare" : "Updating the to-do list";
    case "WebFetch":
      return it ? `Apro ${String(input.url ?? "")}` : `Opening ${String(input.url ?? "")}`;
    case "WebSearch":
      return it ? "Cerco sul web" : "Searching the web";
    default: {
      const mcp = parseMcpTool(toolName);
      return mcp ? `${mcp.server} → ${mcp.tool}` : toolName;
    }
  }
}
