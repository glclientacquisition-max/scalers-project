"use client";

import { useState, useSyncExternalStore } from "react";
import { Popover } from "@base-ui/react/popover";
import { useDeskThemeInitial } from "@/components/DeskThemeProvider";
import { focusRingVisible } from "@/components/ui/deskChrome";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { cx } from "@/lib/cx";
import { SegmentedControl } from "@/components/ui/Segmented";
import {
  applyDeskEffects,
  readDeskEffects,
  subscribeDeskEffects,
  writeDeskEffects,
} from "@/lib/deskEffects";
import {
  applyDeskTheme,
  readDeskTheme,
  subscribeDeskTheme,
  writeDeskTheme,
  type DeskTheme,
} from "@/lib/deskTheme";

const CHOICES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export function useThemeChoice() {
  const initial = useDeskThemeInitial();
  const choice = useSyncExternalStore(subscribeDeskTheme, readDeskTheme, () => initial);

  const pick = (next: DeskTheme) => {
    writeDeskTheme(next);
    applyDeskTheme(next);
  };

  return { choice, pick };
}

function useReduceEffects() {
  const mode = useSyncExternalStore(subscribeDeskEffects, readDeskEffects, () => "full" as const);
  const setReduced = (reduced: boolean) => {
    const next = reduced ? "reduced" : "full";
    writeDeskEffects(next);
    applyDeskEffects(next);
  };
  return { reduced: mode === "reduced", setReduced };
}

/** "Appearance · Light". The one worded entry point, inside and outside the desk. */
export function appearanceLabel(choice: DeskTheme): string {
  const name = CHOICES.find((c) => c.id === choice)?.label ?? "Light";
  return `Appearance · ${name}`;
}

const footerButtonClass = cx(
  "inline-flex min-h-11 items-center rounded-lg px-2 text-meta text-ink-2 hover:text-ink",
  focusRingVisible,
);

const popupClass =
  "glass-chrome z-menu w-72 origin-[var(--transform-origin)] rounded-xl border border-hairline p-3 text-ink shadow-menu outline-none transition-[opacity,transform] duration-fast ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none";

/**
 * Outside the desk (landing, login, signup, invite, onboarding, admin login): a quiet footer text
 * button. Phones get a Sheet, desktop a popover. Same segmented choice as the account menu.
 */
export function AppearanceFooter({ tone = "ink", className }: { tone?: "ink" | "onDark"; className?: string }) {
  const { choice } = useThemeChoice();
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const label = appearanceLabel(choice);
  const buttonClass = cx(footerButtonClass, tone === "onDark" && "text-white/80 hover:text-white", className);

  if (phone) {
    return (
      <div data-appearance-footer="">
        <button type="button" className={buttonClass} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          {label}
        </button>
        <Sheet open={open} onOpenChange={setOpen} title="Appearance">
          <ThemePicker />
        </Sheet>
      </div>
    );
  }

  return (
    <div data-appearance-footer="">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className={buttonClass}>{label}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="right" align="end" sideOffset={8} collisionPadding={12} className="z-menu">
            <Popover.Popup className={popupClass}>
              <Popover.Title className="sr-only">Appearance</Popover.Title>
              <ThemePicker />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** Device theme. Light by default, dark only when picked. Instant apply. Never a tenant setting. */
export function ThemePicker() {
  const { choice, pick } = useThemeChoice();
  const { reduced, setReduced } = useReduceEffects();

  return (
    <div data-theme-cluster="">
      <p className="pb-2 ps-1 text-meta text-ink-2">On this device</p>
      <SegmentedControl
        label="On this device"
        value={choice}
        onChange={(value) => pick(value as DeskTheme)}
        className="grid w-full p-1 [&_button]:min-h-11"
        items={CHOICES.map((opt) => ({ value: opt.id, label: opt.label }))}
      />
      <div className="mt-3 flex min-h-11 items-center justify-between gap-3 ps-1">
        <span className="text-body text-ink">Reduce effects</span>
        <Switch checked={reduced} onCheckedChange={setReduced} label="Reduce effects" />
      </div>
    </div>
  );
}
