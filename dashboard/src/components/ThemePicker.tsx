"use client";

import { useEffect, useState } from "react";
import { deskShiftClass, focusRing } from "@/components/ui/deskChrome";
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

function ThemeMark({ id }: { id: DeskTheme }) {
  if (id === "dark") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-surface" aria-hidden>
        <span className="h-3 w-3 rounded-full bg-surface" />
      </span>
    );
  }
  if (id === "light") {
    return (
      <span
        className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface"
        aria-hidden
      >
        <span className="h-3 w-3 rounded-full border border-ink" />
      </span>
    );
  }
  return (
    <span className="relative h-8 w-8 overflow-hidden rounded-full border border-line" aria-hidden>
      <span className="absolute inset-0 bg-surface" />
      <span className="absolute inset-y-0 right-0 w-1/2 bg-ink" />
    </span>
  );
}

/** Device theme. Instant apply. Never a tenant setting. */
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
