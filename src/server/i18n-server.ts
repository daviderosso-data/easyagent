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
};

export function blockedReason(severity: string, lang: Lang): string {
  const r = REASONS[severity];
  const reason = r ? r[lang] : lang === "it" ? "non è consentita" : "is not allowed";
  return lang === "it"
    ? `Azione bloccata da easyclaude: ${reason}.`
    : `Action blocked by easyclaude: ${reason}.`;
}

export function authError(lang: Lang): string {
  return lang === "it"
    ? "Non risulti autenticato. Apri Impostazioni → Account e accedi con il tuo abbonamento."
    : "You are not signed in. Open Settings → Account and sign in with your subscription.";
}

export function genericError(lang: Lang): string {
  return lang === "it"
    ? "Si è verificato un errore durante l'esecuzione. Riprova."
    : "Something went wrong during execution. Please try again.";
}
