"use client";

import { useAgent } from "@/store/agent";
import { detectProfile } from "@/lib/settings";
import { useT } from "@/i18n";
import { ThemeToggle } from "@/components/ThemeToggle";

const PROFILE_KEY = {
  locked: "profileLocked",
  standard: "profileStandard",
  open: "profileOpen",
  custom: "profileCustom",
} as const;

export function AppShell({ onOpenSettings, children }: { onOpenSettings: () => void; children: React.ReactNode }) {
  const model = useAgent((s) => s.sessions[s.activePanel]?.model ?? null);
  const apiKeySource = useAgent((s) => s.sessions[s.activePanel]?.apiKeySource ?? null);
  const security = useAgent((s) => s.settings.security);
  const t = useT();

  const profile = detectProfile(security);
  const shieldOk = profile !== "open" && security.blockCatastrophic;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          <span className="brand-name">{t("brand")}</span>
        </div>

        <div className="topbar-controls">
          {/* Passive status indicator (Settings is the ⚙️ button — no redundancy). */}
          <div className={`shield ${shieldOk ? "shield-ok" : "shield-warn"}`} title={t("secSecurity")}>
            <span>🛡️</span>
            <span>{t(PROFILE_KEY[profile])}</span>
          </div>

          <div className="account" title={model ? `Model: ${model}` : t("ready")}>
            <span className={`dot ${apiKeySource ? "dot-ok" : "dot-idle"}`} />
            <span className="account-text">{apiKeySource ? t("subscription") : t("ready")}</span>
          </div>

          <ThemeToggle />

          <button className="icon-btn" onClick={onOpenSettings} title={t("settings")} aria-label={t("settings")}>
            ⚙️
          </button>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  );
}
