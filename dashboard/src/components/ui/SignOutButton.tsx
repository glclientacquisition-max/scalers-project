"use client";

import { useEffect, useState } from "react";
import {
  btnPrimary,
  deskShiftClass,
  focusRing,
  focusRingVisible,
} from "@/components/ui/deskChrome";

const stayClass = [
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium text-ink-soft",
  deskShiftClass,
  "hover:bg-surface hover:text-ink active:bg-line",
  focusRingVisible,
].join(" ");

/** Confirm, then POST `/api/logout`. The account menu uses `layout="menu"`. */
export function SignOutButton({ layout = "inline" }: { layout?: "inline" | "menu" }) {
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
    if (layout === "menu") {
      return (
        <button
          type="button"
          role="menuitem"
          onClick={() => setConfirming(true)}
          className={[
            "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-warn",
            deskShiftClass,
            "hover:bg-warn-soft active:bg-warn-soft",
            focusRing,
          ].join(" ")}
        >
          Sign out
        </button>
      );
    }
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

  const confirm = (
    <>
      <p className="text-sm font-medium text-ink">Sign out?</p>
      <form action="/api/logout" method="post">
        <button type="submit" className={btnPrimary}>
          Sign out
        </button>
      </form>
      <button type="button" onClick={() => setConfirming(false)} className={stayClass}>
        Stay
      </button>
    </>
  );

  if (layout === "menu") {
    return (
      <div role="group" aria-label="Sign out?" className="flex flex-wrap items-center gap-2 px-2 py-2">
        {confirm}
      </div>
    );
  }

  return (
    <div role="group" aria-label="Sign out?" className="flex flex-wrap items-center gap-2">
      {confirm}
    </div>
  );
}
