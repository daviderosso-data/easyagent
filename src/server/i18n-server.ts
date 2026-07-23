import type { Lang } from "@/lib/settings";

// Server-side strings that end up in the SDK stream (block reason -> tool_result,
// error messages). UI chrome is localized on the client (src/i18n).

const REASONS: Record<string, { en: string; it: string }> = {
  catastrophic: { en: "could damage your system", it: "può danneggiare il sistema" },
  secret: { en: "would read credentials or secrets", it: "leggerebbe credenziali o segreti" },
  escape: { en: "writes outside the project folder", it: "scrive fuori dalla cartella del progetto" },
  install: { en: "installs or removes software", it: "installa o rimuove software" },
  network: { en: "accesses the internet or sends data out", it: "accede a Internet o invia dati all'esterno" },
  broaddelete: { en: "may delete multiple files", it: "può eliminare più file" },
  perms: { en: "changes file permissions", it: "cambia i permessi dei file" },
  kill: { en: "stops other running programs", it: "termina altri programmi in esecuzione" },
  mcp: { en: "uses an external connection, which is turned off in the Locked profile", it: "usa un collegamento esterno, disattivato nel profilo Blindato" },
};

export function blockedReason(severity: string, lang: Lang): string {
  const r = REASONS[severity];
  const reason = r ? r[lang] : lang === "it" ? "non è consentita" : "is not allowed";
  return lang === "it"
    ? `Azione bloccata da easyagent: ${reason}.`
    : `Action blocked by easyagent: ${reason}.`;
}

export function authError(lang: Lang): string {
  return lang === "it"
    ? "Non risulti autenticato. Apri Impostazioni → Account e accedi con il tuo abbonamento."
    : "You are not signed in. Open Settings → Account and sign in with your subscription.";
}

export function engineUnavailable(label: string, lang: Lang): string {
  return lang === "it"
    ? `${label} non è disponibile su questo computer. Installalo (o avvialo) e riprova.`
    : `${label} is not available on this computer. Install (or start) it and try again.`;
}

/** Matches provider messages that mean "you hit your usage limit". */
export const RATE_LIMIT_RE = /rate.?limit|429|too many requests|usage limit|quota|out of (?:usage|credits)/i;

export function rateLimitError(lang: Lang): string {
  return lang === "it"
    ? "L'engine ha raggiunto il limite di utilizzo. Riprova più tardi o continua con un altro engine."
    : "The engine hit its usage limit. Try again later or continue with another engine.";
}

export function genericError(lang: Lang): string {
  return lang === "it"
    ? "Si è verificato un errore durante l'esecuzione. Riprova."
    : "Something went wrong during execution. Please try again.";
}
