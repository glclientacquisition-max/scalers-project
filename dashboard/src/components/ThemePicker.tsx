"use client";

import { useEffect, useState } from "react";
import { SettingsSegmented } from "@/components/settingsUi";
import {
  applyDeskTheme,
  readDeskTheme,
  writeDeskTheme,
  type DeskTheme,
} from "@/lib/deskTheme";

const CHOICES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

/** Device-level appearance for the desk. Instant apply; never a tenant setting. */
export function ThemePicker() {
  const [choice, setChoice] = useState<DeskTheme>("system");

  useEffect(() => {
    const saved = readDeskTheme();
    setChoice(saved);
    applyDeskTheme(saved);
  }, []);

  const pick = (next: DeskTheme) => {
    setChoice(next);
    writeDeskTheme(next);
    applyDeskTheme(next);
  };

  return (
    <SettingsSegmented
      label="This device"
      value={choice}
      options={CHOICES}
      onChange={pick}
    />
  );
}
