"use client";

import { useEffect, useState } from "react";
import {
  btnPrimary,
  deskShiftClass,
  focusRingVisible,
} from "@/components/ui/deskChrome";

/** Muted logout. Confirm, then POST `/api/logout`. Lives on Profile, not in shell chrome. */
export function SignOutButton() {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirming(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={[
          "inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-ink-soft hover:text-warn",
          deskShiftClass,
          focusRingVisible,
        ].join(" ")}
      >
        Sign out
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Sign out?"
      className="flex flex-wrap items-center gap-2"
    >
      <p className="text-sm font-medium text-ink">Sign out?</p>
      <form action="/api/logout" method="post">
        <button type="submit" className={btnPrimary}>
          Sign out
        </button>
      </form>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className={[
          "inline-flex min-h-11 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium text-ink-soft",
          deskShiftClass,
          "hover:bg-surface hover:text-ink active:bg-line",
          focusRingVisible,
        ].join(" ")}
      >
        Stay
      </button>
    </div>
  );
}
