"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { StepUpSheet } from "./StepUpSheet";

/** One Unlock control for Admin v2. Opens StepUpSheet; never writes domain state alone. */
export function UnlockCta({
  action, what, site, target, label = "Unlock to edit", variant = "primary", size = "sm", onUnlocked, observedHint,
}: {
  action: string;
  what: string;
  site: string;
  target?: string | null;
  label?: string;
  variant?: "primary" | "ghost";
  size?: "sm" | "md";
  onUnlocked?: () => void;
  observedHint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} data-stepup={site} data-honest="unlock" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <StepUpSheet
        open={open}
        onClose={() => setOpen(false)}
        action={action}
        target={target}
        what={what}
        onObserved={onUnlocked}
        observedHint={observedHint}
      />
    </>
  );
}
