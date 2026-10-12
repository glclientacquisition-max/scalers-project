"use client";

import { useState } from "react";
import { switchDeskTenant } from "@/app/(desk)/tenantActions";
import { BrandLockup } from "@/components/brand/BrandMark";
import { ThemePicker, appearanceLabel, useThemeChoice } from "@/components/ThemePicker";
import { iconButtonClass } from "@/components/ui/IconButton";
import { Menu, MenuGroup, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/Menu";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { Sheet } from "@/components/ui/Sheet";
import { useIsPhone } from "@/components/ui/useIsPhone";
import { cx } from "@/lib/cx";
import { deskRowInitials } from "@/components/ui/deskRow";

function accountInitials(name: string): string {
  return deskRowInitials(name) || name.trim().slice(0, 1).toUpperCase() || "W";
}

const sheetRowClass =
  "flex min-h-12 w-full items-center justify-between gap-3 px-4 text-start text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";

/**
 * Phones: the avatar opens a bottom Sheet (grouped rows, 48px targets, theme inline).
 * md+: the same items in an anchored Menu.
 */
function AccountSheet({
  open,
  onOpenChange,
  name,
  tenantId,
  workspaces,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  tenantId: string;
  workspaces: Array<{ id: string; name: string }>;
}) {
  const many = workspaces.length > 1;
  const theme = useThemeChoice();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={name}>
      <div data-account-sheet="" className="space-y-6">
        {many ? (
          <section aria-labelledby="account-sheet-workspace">
            <h3 id="account-sheet-workspace" className="mb-2 px-1 text-meta font-medium text-ink-2">
              Workspace
            </h3>
            <ul className="overflow-hidden rounded-2xl border border-line bg-canvas">
              {workspaces.map((row) => {
                const current = row.id === tenantId;
                return (
                  <li key={row.id} className="border-b border-hairline last:border-b-0">
                    <form action={switchDeskTenant}>
                      <input type="hidden" name="tenant_id" value={row.id} />
                      <button
                        type="submit"
                        aria-current={current ? "true" : undefined}
                        className={cx(sheetRowClass, current ? "font-semibold" : "text-ink-2", "hover:bg-surface-2")}
                      >
                        <span className="min-w-0 truncate">{row.name}</span>
                        {current ? <span className="text-meta text-ink-2">Current</span> : null}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <section aria-labelledby="account-sheet-appearance" data-account-sheet-card="" className="rounded-2xl border border-line bg-canvas p-3">
          <h3 id="account-sheet-appearance" className="mb-2 ps-1 text-body font-medium text-ink">
            {appearanceLabel(theme.choice)}
          </h3>
          <ThemePicker />
        </section>
        <div className="overflow-hidden rounded-2xl border border-line bg-canvas">
          <SignOutButton layout="sheet" />
        </div>
      </div>
    </Sheet>
  );
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
  const phone = useIsPhone();
  const theme = useThemeChoice();
  const [sheetOpen, setSheetOpen] = useState(false);
  const avatar = (lit: boolean) => (
    <span
      className={cx(
        "inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-meta font-semibold text-accent-on",
        lit ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "",
      )}
    >
      {initials}
    </span>
  );

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
      {phone ? (
        <>
          <button
            type="button"
            aria-label={name}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className={iconButtonClass()}
          >
            {avatar(sheetOpen)}
          </button>
          <AccountSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            name={name}
            tenantId={tenantId}
            workspaces={workspaces}
          />
        </>
      ) : (
      <Menu
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setThemeOpen(false);
        }}
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
        <div data-account-menu="" role="presentation">
          <p role="presentation" className="pointer-events-none truncate px-3 pb-1 pt-2 text-body font-semibold text-ink">{name}</p>
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
      )}
    </div>
  );
}
