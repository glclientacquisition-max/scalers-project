"use client";

import { Button } from "@/components/ui/Button";
import { useOpenAdminUnlock } from "@/components/ops/AdminUnlockProvider";
import { useAdminUnlockSession } from "@/components/ops/useAdminUnlockSession";

/** Global Admin header Unlock: locked/unlocked state and time left. One control on every v2 page. */
export function AdminHeaderUnlock() {
  const session = useAdminUnlockSession();
  const openUnlock = useOpenAdminUnlock();
  const enforce = session.status?.mode === "enforce";
  const showUnlocked = enforce && session.unlocked;

  if (showUnlocked) {
    return (
      <span
        className="shrink-0 text-caption tabular-nums text-ink-2 sm:text-meta"
        data-unlocked=""
        data-stepup="header"
        data-admin-header-unlock=""
      >
        Unlocked · {session.remaining.text}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0 px-2 text-caption sm:text-meta"
      data-stepup="header"
      data-honest="unlock"
      data-admin-header-unlock=""
      onClick={() =>
        openUnlock({
          action: "unlock",
          what: "make risky changes",
        })
      }
    >
      {enforce && session.locked ? "Locked" : "Unlock"}
    </Button>
  );
}
