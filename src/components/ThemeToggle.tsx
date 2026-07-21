"use client";

import { useEffect, useState } from "react";
import { useAgent } from "@/store/agent";
import { Icon } from "@/components/icons";

// Applies the theme to <html data-theme> and offers a quick light/dark toggle.
export function ThemeToggle() {
  const theme = useAgent((s) => s.settings.theme);
  const setTheme = useAgent((s) => s.setTheme);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const resolve = () => {
      const isDark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      setDark(isDark);
    };
    resolve();
    if (theme === "system") {
      mq.addEventListener("change", resolve);
      return () => mq.removeEventListener("change", resolve);
    }
  }, [theme]);

  return (
    <button className="icon-btn" onClick={() => setTheme(dark ? "light" : "dark")} title="Theme" aria-label="Theme">
      <Icon name={dark ? "sun" : "moon"} size={15} />
    </button>
  );
}
