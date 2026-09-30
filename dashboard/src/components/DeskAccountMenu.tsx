"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { switchDeskTenant } from "@/app/(desk)/tenantActions";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { deskShiftClass, focusRing, focusRingVisible } from "@/components/ui/deskChrome";
import { deskRowInitials } from "@/components/ui/deskRow";
import { businessSettingsHref } from "@/lib/businessSettingsNav";

const itemClass = [
  "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-ink",
  deskShiftClass,
  "hover:bg-accent/[0.04] active:bg-accent/[0.08]",
  focusRing,
].join(" ");

function accountInitials(name: string): string {
  return deskRowInitials(name) || name.trim().slice(0, 1).toUpperCase() || "W";
}

/** Quiet account trigger. Appearance, Profile, then Sign out. */
export function DeskAccountMenu({
  name,
  tenantId,
  workspaces,
}: {
  name: string;
  tenantId: string;
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const many = workspaces.length > 1;
  const initials = accountInitials(name);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const first = menu?.querySelector<HTMLElement>("[role='menuitem']");
    first?.focus();

    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menu?.querySelectorAll<HTMLElement>("[role='menuitem']") || [])];
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
      className="relative flex min-h-12 shrink-0 items-center justify-end border-b border-line bg-surface px-3 sm:px-4"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={name}
        onClick={() => setOpen((current) => !current)}
        className={[
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-ink",
          deskShiftClass,
          "hover:bg-accent/[0.08] active:bg-accent/[0.12]",
          focusRingVisible,
        ].join(" ")}
      >
        {initials}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          data-account-menu=""
          className="absolute end-3 top-12 z-40 w-[min(16rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-surface p-1"
        >
          {many ? (
            <div className="pb-1">
              <p className="pointer-events-none px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Workspace
              </p>
              {workspaces.map((row) => {
                const current = row.id === tenantId;
                return (
                  <form key={row.id} action={switchDeskTenant}>
                    <input type="hidden" name="tenant_id" value={row.id} />
                    <button
                      type="submit"
                      role="menuitem"
                      aria-current={current ? "true" : undefined}
                      className={[
                        itemClass,
                        "truncate",
                        current ? "text-ink" : "font-normal text-ink-soft",
                      ].join(" ")}
                    >
                      {row.name}
                    </button>
                  </form>
                );
              })}
              <div className="mx-2 my-1 border-t border-line" role="separator" />
            </div>
          ) : null}
          <Link
            href={businessSettingsHref("appearance")}
            role="menuitem"
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            Appearance
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            Profile
          </Link>
          <div className="mx-2 my-1 border-t border-line" role="separator" />
          <SignOutButton layout="menu" />
        </div>
      ) : null}
    </div>
  );
}
