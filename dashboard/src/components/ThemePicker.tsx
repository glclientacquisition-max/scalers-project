"use client";

import { useEffect, useState } from "react";
import { deskShiftClass, focusRing, focusRingVisible } from "@/components/ui/deskChrome";
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

function useThemeChoice() {
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

  return { choice, pick };
}

function ThemeMark({ id, size = "md" }: { id: DeskTheme; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const dot = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";
  if (id === "dark") {
    return (
      <span className={`flex ${box} items-center justify-center rounded-full bg-ink text-surface`} aria-hidden>
        <span className={`${dot} rounded-full bg-surface`} />
      </span>
    );
  }
  if (id === "light") {
    return (
      <span
        className={`flex ${box} items-center justify-center rounded-full border border-line bg-surface`}
        aria-hidden
      >
        <span className={`${dot} rounded-full border border-ink`} />
      </span>
    );
  }
  return (
    <span className={`relative ${box} overflow-hidden rounded-full border border-line`} aria-hidden>
      <span className="absolute inset-0 bg-surface" />
      <span className="absolute inset-y-0 right-0 w-1/2 bg-ink" />
    </span>
  );
}

/** Compact 44px hits for marketing and auth. Same per-device store as ThemePicker. */
export function ThemeDock({ tone = "ink" }: { tone?: "ink" | "onDark" }) {
  const { choice, pick } = useThemeChoice();
  const onDark = tone === "onDark";

  return (
    <div
      role="radiogroup"
      aria-label="This device"
      data-theme-cluster=""
      className="flex items-center gap-1"
    >
      {CHOICES.map((opt) => {
        const selected = choice === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.label}
            onClick={() => pick(opt.id)}
            className={[
              "inline-flex h-11 w-11 items-center justify-center rounded-full",
              deskShiftClass,
              focusRingVisible,
              onDark
                ? selected
                  ? "bg-surface/25 text-white"
                  : "text-white/80 hover:bg-surface/10 hover:text-white"
                : selected
                  ? "bg-accent/10 text-ink"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            ].join(" ")}
          >
            <ThemeMark id={opt.id} size="sm" />
          </button>
        );
      })}
    </div>
  );
}

/** Device theme. Instant apply. Never a tenant setting. */
export function ThemePicker() {
  const { choice, pick } = useThemeChoice();

  return (
    <div role="radiogroup" aria-label="This device" data-theme-cluster="" className="grid grid-cols-3 gap-2">
      {CHOICES.map((opt) => {
        const selected = choice === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => pick(opt.id)}
            className={[
              "flex min-h-[4.75rem] flex-col items-center justify-center gap-2 rounded-xl border px-2 text-sm font-medium text-ink",
              deskShiftClass,
              focusRing,
              selected
                ? "border-accent bg-accent/10"
                : "border-line bg-surface hover:bg-accent/[0.04] active:bg-accent/[0.08]",
            ].join(" ")}
          >
            <ThemeMark id={opt.id} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
