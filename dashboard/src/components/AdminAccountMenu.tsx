"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BrandLockup } from "@/components/brand/BrandMark";
import { ThemePicker } from "@/components/ThemePicker";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { deskShiftClass, focusRing, focusRingVisible } from "@/components/ui/deskChrome";
import { deskRowInitials } from "@/components/ui/deskRow";

const itemClass = [
  "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-ink",
  deskShiftClass,
  "hover:bg-accent/[0.04] active:bg-accent/[0.08]",
  focusRing,
].join(" ");

function accountInitials(name: string): string {
  return deskRowInitials(name) || name.trim().slice(0, 1).toUpperCase() || "O";
}

/** Same account strip as the owner desk. Initials open Appearance and Sign out. */
export function AdminAccountMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const themeId = useId();
  const initials = accountInitials(name);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const first = menu?.querySelector<HTMLElement>("[role='menuitem']");
    first?.focus();

    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setThemeOpen(false);
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setThemeOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [
        ...(menu?.querySelectorAll<HTMLElement>("[role='menuitem'], [data-theme-cluster] [role='radio']") ||
          []),
      ];
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = items[(index + step + items.length) % items.length];
      next?.focus();
    }

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      data-account-bar=""
      className="relative flex min-h-12 shrink-0 items-center justify-end gap-2 border-b border-line bg-surface px-3 sm:px-4"
    >
      <div className="me-auto md:hidden">
        <BrandLockup
          href="/admin"
          name="Scalers"
          size="sm"
          markOnly
          scroll={false}
          className="min-h-11 min-w-11 justify-center"
        />
      </div>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={name}
        onClick={() => {
          setOpen((current) => !current);
          setThemeOpen(false);
        }}
        className={[
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
          deskShiftClass,
          "hover:bg-accent/[0.08] active:bg-accent/[0.12]",
          focusRingVisible,
        ].join(" ")}
      >
        <span
          className={[
            "inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-on",
            open ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "",
          ].join(" ")}
        >
          {initials}
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          data-account-menu=""
          className={[
            "absolute end-3 top-12 z-40 rounded-xl border border-line glass-chrome p-1 shadow-menu",
            themeOpen
              ? "w-[min(22rem,calc(100vw-1.5rem))]"
              : "w-[min(16rem,calc(100vw-1.5rem))]",
          ].join(" ")}
        >
          <p className="pointer-events-none truncate px-3 pb-1 pt-2 text-sm font-semibold text-ink">
            {name}
          </p>
          <div className="mx-2 my-1 border-t border-line" role="separator" />
          <button
            type="button"
            role="menuitem"
            aria-expanded={themeOpen}
            aria-controls={themeId}
            className={itemClass}
            onClick={() => setThemeOpen((current) => !current)}
          >
            Appearance
          </button>
          {themeOpen ? (
            <div id={themeId} data-account-appearance="" className="px-2 pb-2">
              <p className="pointer-events-none px-1 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-ink-3">
                This device
              </p>
              <ThemePicker />
            </div>
          ) : null}
          <div className="mx-2 my-1 border-t border-line" role="separator" />
          <SignOutButton layout="menu" />
        </div>
      ) : null}
    </div>
  );
}
