"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import {
  deskShiftClass,
  focusRingVisible,
} from "@/components/ui/deskChrome";
import { MenuItem } from "@/components/ui/Menu";

const stayClass = [
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-transparent px-3 text-body font-medium text-ink-2",
  deskShiftClass,
  "hover:bg-surface hover:text-ink active:bg-hairline",
  focusRingVisible,
].join(" ");

/** Confirm, then POST `/api/logout`. The account menu uses `layout="menu"`. */
export function SignOutButton({ layout = "inline" }: { layout?: "inline" | "menu" | "sheet" }) {
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
        <MenuItem closeOnClick={false} tone="attention" onClick={() => setConfirming(true)}>
          Sign out
        </MenuItem>
      );
    }
    if (layout === "sheet") {
      return (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={[
            "flex min-h-12 w-full items-center px-4 text-start text-body font-medium text-attention",
            deskShiftClass,
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
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
          "inline-flex min-h-11 items-center rounded-md px-2 text-body font-medium text-ink-2 hover:text-warn",
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
      <p className="text-body font-medium text-ink">Sign out?</p>
      <form action="/api/logout" method="post">
        <Button type="submit">
          Sign out
        </Button>
      </form>
      <button type="button" onClick={() => setConfirming(false)} className={stayClass}>
        Stay
      </button>
    </>
  );

  if (layout === "menu" || layout === "sheet") {
    return (
      <div role="group" aria-label="Sign out?" className={layout === "sheet" ? "flex flex-wrap items-center gap-2 px-4 py-3" : "flex flex-wrap items-center gap-2 px-2 py-2"}>
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
