"use client";

import { useEffect, useState } from "react";
import { SettingsSegmented } from "@/components/settingsUi";

const THEME_KEY = "scalers-desk-theme";
const CHOICES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

type DeskTheme = (typeof CHOICES)[number]["id"];

function applyTheme(choice: DeskTheme) {
  const root = document.documentElement;
  if (choice === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
}

/** Device-level appearance for the desk. Instant apply; never a tenant setting. */
export function ThemePicker() {
  const [choice, setChoice] = useState<DeskTheme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setChoice(saved);
    } catch {
      // private mode: system default stands
    }
  }, []);

  const pick = (next: DeskTheme) => {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // still applies for this session via applyTheme
    }
    applyTheme(next);
  };

  return (
    <SettingsSegmented
      label="Appearance"
      value={choice}
      options={CHOICES}
      onChange={pick}
    />
  );
}
