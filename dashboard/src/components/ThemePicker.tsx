"use client";

import { useEffect, useState } from "react";

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
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="grid w-full grid-cols-3 gap-1 rounded-xl border border-line bg-surface-muted p-1 sm:w-60"
    >
      {CHOICES.map((option) => {
        const active = choice === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => pick(option.id)}
            className={[
              "min-h-11 rounded-lg px-3 text-sm font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              active
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-soft hover:text-ink",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
