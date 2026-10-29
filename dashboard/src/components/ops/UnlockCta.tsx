"use client";

import { Button } from "@/components/ui/Button";
import { useOpenAdminUnlock } from "./AdminUnlockProvider";
import { useAdminUnlockSession } from "./useAdminUnlockSession";

/** Opens the shared StepUpSheet. Prefer AdminHeaderUnlock for global chrome; use this for inline gates when needed. */
export function UnlockCta({
  action, what, site, target, label = "Unlock", variant = "primary", size = "sm", observedHint,
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
  const openUnlock = useOpenAdminUnlock();
  const session = useAdminUnlockSession();
  const showUnlocked = session.unlocked && session.status?.mode === "enforce";

  if (showUnlocked) {
    return (
      <span className="text-ops-label text-ink-2 tabular-nums" data-unlocked="" data-stepup={site}>
        Unlocked · {session.remaining.text}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      data-stepup={site}
      data-honest="unlock"
      onClick={() => openUnlock({ action, what, target, observedHint })}
    >
      {label}
    </Button>
  );
}
