"use client";

import { useState } from "react";
import { switchDeskTenant } from "@/app/(desk)/tenantActions";
import { BrandLockup } from "@/components/brand/BrandMark";
import { ThemePicker } from "@/components/ThemePicker";
import { iconButtonClass } from "@/components/ui/IconButton";
import { Menu, MenuGroup, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/Menu";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { cx } from "@/lib/cx";
import { deskRowInitials } from "@/components/ui/deskRow";

function accountInitials(name: string): string {
  return deskRowInitials(name) || name.trim().slice(0, 1).toUpperCase() || "W";
}

/** Phone mark, avatar, then Appearance and Sign out. The workspace name stays in the menu. */
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
  const [themeOpen, setThemeOpen] = useState(false);
  const many = workspaces.length > 1;
  const initials = accountInitials(name);

  return (
    <div
      data-account-bar=""
      className="relative flex min-h-12 shrink-0 items-center justify-end gap-2 border-b border-hairline bg-surface px-3 sm:px-4"
    >
      <div className="me-auto md:hidden">
        <BrandLockup
          href="/home"
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
                "inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-on",
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
          {many ? (
            <MenuGroup>
              <MenuLabel>Workspace</MenuLabel>
              {workspaces.map((row) => {
                const current = row.id === tenantId;
                return (
                  <form key={row.id} action={switchDeskTenant}>
                    <input type="hidden" name="tenant_id" value={row.id} />
                    <MenuItem
                      nativeButton
                      render={<button type="submit" />}
                      aria-current={current ? "true" : undefined}
                      className={current ? undefined : "font-normal text-ink-2"}
                    >
                      {row.name}
                    </MenuItem>
                  </form>
                );
              })}
              <MenuSeparator />
            </MenuGroup>
          ) : null}
          <MenuItem
            closeOnClick={false}
            aria-expanded={themeOpen}
            onClick={() => setThemeOpen((current) => !current)}
          >
            Appearance
          </MenuItem>
          {themeOpen ? (
            <div data-account-appearance="" className="px-2 pb-2">
              <p className="pointer-events-none px-1 pb-2 pt-1 text-caption font-medium uppercase tracking-wide text-ink-3">
                This device
              </p>
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
