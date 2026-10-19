"use client";

import { useState } from "react";
import { BrandLockup } from "@/components/brand/BrandMark";
import { ThemePicker, appearanceLabel, useThemeChoice } from "@/components/ThemePicker";
import { iconButtonClass } from "@/components/ui/IconButton";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { AdminGlobalSearch } from "@/components/admin/AdminGlobalSearch";
import { cx } from "@/lib/cx";
import { deskRowInitials } from "@/components/ui/deskRow";

function accountInitials(name: string): string {
  return deskRowInitials(name) || name.trim().slice(0, 1).toUpperCase() || "O";
}

/** Same account strip as the owner desk. Initials open Appearance and Sign out. */
export function AdminAccountMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const theme = useThemeChoice();
  const initials = accountInitials(name);

  return (
    <div
      data-account-bar=""
      className="relative flex min-h-12 shrink-0 items-center justify-end gap-2 border-b border-hairline bg-surface px-3 sm:px-4"
    >
      <div className="me-auto hidden min-w-0 flex-1 md:block md:max-w-md lg:max-w-lg">
        <AdminGlobalSearch />
      </div>
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
      <Menu
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setThemeOpen(false);
        }}
        popupClassName={themeOpen ? "w-[min(22rem,calc(100vw-1.5rem))]" : undefined}
        trigger={
          <button type="button" aria-label={name} className={iconButtonClass()}>
            <span
              className={cx(
                "inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-meta font-semibold text-accent-on",
                open ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "",
              )}
            >
              {initials}
            </span>
          </button>
        }
      >
        <div data-account-menu="">
          <p className="pointer-events-none truncate px-3 pb-1 pt-2 text-body font-semibold text-ink">{name}</p>
          <MenuSeparator />
          <MenuItem
            closeOnClick={false}
            aria-expanded={themeOpen}
            onClick={() => setThemeOpen((current) => !current)}
          >
            {appearanceLabel(theme.choice)}
          </MenuItem>
          {themeOpen ? (
            <div data-account-appearance="" className="px-2 pb-2">
              <ThemePicker />
            </div>
          ) : null}
          <MenuSeparator />
          <SignOutButton layout="menu" />
        </div>
      </Menu>
    </div>
  );
}
