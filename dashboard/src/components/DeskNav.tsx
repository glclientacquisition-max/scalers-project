"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, type MouseEvent } from "react";
import { BrandLockup } from "@/components/brand/BrandMark";
import {
  useDeskNeedsCount,
  useDeskPendingHref,
  useDeskPendingSetter,
} from "@/components/DeskNavState";
import { DeskHint } from "@/components/ui/DeskHint";
import {
  deskNavBadgeClass,
  deskShiftClass,
  focusRingVisible,
} from "@/components/ui/deskChrome";
import {
  formatAttentionCount,
  formatInboxNavAriaLabel,
} from "@/lib/deskAttentionCount";
import { deskPhoneTabHref, isDeskNestedPath } from "@/lib/deskTicketChat";
import { PHONE_TAB_REFRESH_EVENT } from "@/lib/endlessList";

export const DESK_LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/calls", label: "Inbox" },
  { href: "/contacts", label: "Contacts" },
  { href: "/wallet", label: "Usage" },
  { href: "/settings", label: "Profile" },
] as const;

/**
 * Viewport desk chrome. Fixed to the same box as the tab bar.
 * `h-dvh` is shorter than that box on phones, so the light body showed under the shell.
 */
export const deskShellClass =
  "desk-theme fixed inset-0 flex min-w-0 overflow-hidden";

/**
 * Page frame next to the rail.
 * Live ticket bleed is in globals.css on `[data-desk-ticket-chat]`.
 * Do not use `:has([data-desk-bleed])` after the shell is route-ready:
 * Next keeps the ticket mounted in a hidden Activity, and that copy would
 * lock this well after the owner returns to the list.
 */
export const deskMainClass =
  "mx-auto w-full min-h-0 min-w-0 max-w-desk flex-1 overflow-y-auto px-4 pt-4 pb-[var(--desk-tabbar-clearance)] sm:px-6 sm:pt-6 md:p-6 md:has-[[data-settings-console]]:max-w-none";

function pathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TabIcon({ name, className }: { name: string; className?: string }) {
  const cls = className || "h-5 w-5";
  if (name === "Overview") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <path
          d="M3 3.5h6.5V10H3V3.5Zm7.5 0H17V8h-6.5V3.5ZM3 11.5h6.5V17H3v-5.5Zm7.5 0H17V17h-6.5v-5.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  if (name === "Inbox") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <path
          d="M3.5 5.5h13v10h-13v-10Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M3.5 11.5h3.2L8 13.5h4l1.3-2h3.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === "Contacts") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <circle cx="7" cy="7" r="2.25" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="13.5" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M3.5 15.5c.4-2.2 2-3.5 3.5-3.5s3.1 1.3 3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M11.5 15.5c.3-1.6 1.4-2.5 2.5-2.5 1.1 0 2.1.9 2.5 2.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === "Profile") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <circle cx="10" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M4.5 16.5c.7-3.1 2.8-4.75 5.5-4.75s4.8 1.65 5.5 4.75"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
      <rect
        x="3.5"
        y="5.5"
        width="13"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M3.5 8.5h13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function TabIconWithBadge({ name, count: needsCount }: { name: string; count: number }) {
  const display = name === "Inbox" ? formatAttentionCount(needsCount) : null;
  return (
    <span className="relative inline-flex overflow-visible">
      <TabIcon name={name} />
      {display ? (
        <span aria-hidden="true" className={`pointer-events-none ${deskNavBadgeClass}`}>
          {display}
        </span>
      ) : null}
    </span>
  );
}

function inboxLinkAria(label: string, needsCount: number) {
  if (label !== "Inbox") return undefined;
  return formatInboxNavAriaLabel(needsCount) || undefined;
}

/** Sets the shared destination before paint. `useLinkStatus` only works inside `Link`. */
function DeskLinkPending({ href }: { href: string }) {
  const { pending } = useLinkStatus();
  const setPending = useDeskPendingSetter();
  useLayoutEffect(() => {
    if (pending) {
      setPending(href);
      return;
    }
    setPending((current) => (current === href ? null : current));
  }, [pending, href, setPending]);
  return null;
}

function DeskDestinationLink({
  href,
  label,
  count,
  className,
  activeClassName,
  idleClassName,
  labelClassName,
  ariaLabel,
  onRetap,
}: {
  href: string;
  label: string;
  count: number;
  className: string;
  activeClassName: string;
  idleClassName: string;
  labelClassName: string;
  ariaLabel?: string;
  onRetap?: () => void;
}) {
  const pathname = usePathname();
  const pendingHref = useDeskPendingHref();
  const current = pathActive(pathname, href);
  const active = pendingHref ? pendingHref === href : current;

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onRetap || !current || pendingHref) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    event.preventDefault();
    onRetap();
  }

  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      className={[
        className,
        deskShiftClass,
        focusRingVisible,
        active ? activeClassName : idleClassName,
      ].join(" ")}
    >
      <DeskLinkPending href={href} />
      <TabIconWithBadge name={label} count={count} />
      <span className={labelClassName}>{label}</span>
    </Link>
  );
}

/** md+ destination rail. Same DESK_LINKS as DeskTabBar. Sign out lives on Profile. */
export function DeskRail({
  needsCount = 0,
  homeHref = "/home",
}: {
  needsCount?: number;
  homeHref?: string;
}) {
  const fromShell = useDeskNeedsCount();
  const count = needsCount || fromShell;

  return (
    <div
      data-desk-rail=""
      className="hidden h-full w-[5.5rem] shrink-0 flex-col border-r border-line/80 bg-surface md:flex"
    >
      <div className="flex h-14 items-center justify-center">
        <DeskHint label="Scalers">
          <BrandLockup
            href={homeHref}
            name="Scalers"
            size="sm"
            markOnly
            priority
            scroll={false}
            className="min-h-11 min-w-11 justify-center"
          />
        </DeskHint>
      </div>
      <nav aria-label="Workspace" className="flex flex-1 flex-col items-center gap-1 px-1 pt-1">
        {DESK_LINKS.map((item) => (
          <DeskDestinationLink
            key={item.href}
            href={item.href}
            label={item.label}
            count={count}
            ariaLabel={inboxLinkAria(item.label, count) || item.label}
            className="flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5"
            activeClassName="bg-accent/10 text-accent-deep"
            idleClassName="text-ink-soft hover:bg-surface-muted hover:text-ink"
            labelClassName="max-w-full truncate text-[10px] font-medium leading-none"
          />
        ))}
      </nav>
    </div>
  );
}

function retapPhoneTab() {
  const well = document.querySelector("[data-desk-main]");
  if (well instanceof HTMLElement) well.scrollTop = 0;
  window.dispatchEvent(new Event(PHONE_TAB_REFRESH_EVENT));
}

/** Phone thumb destinations. Same DESK_LINKS as the desktop rail. Hidden on nested insides. */
export function DeskTabBar({ needsCount = 0 }: { needsCount?: number }) {
  const pathname = usePathname();
  const fromShell = useDeskNeedsCount();
  const count = needsCount || fromShell;
  if (isDeskNestedPath(pathname)) return null;

  return (
    <nav
      data-desk-tabbar=""
      aria-label="Workspace"
      className="fixed inset-x-0 bottom-0 z-50 isolate min-h-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom,0px))] overflow-visible border-t border-line/80 bg-surface pb-[env(safe-area-inset-bottom)] shadow-none md:hidden"
    >
      <ul className="flex">
        {DESK_LINKS.map((item) => (
          <li key={item.href} className="min-w-0 flex-1 overflow-visible">
            <DeskDestinationLink
              href={deskPhoneTabHref(item.href, pathname)}
              label={item.label}
              count={count}
              ariaLabel={inboxLinkAria(item.label, count)}
              onRetap={retapPhoneTab}
              className="flex min-h-12 w-full min-w-0 flex-col items-center justify-center gap-0.5 overflow-visible px-0.5 pt-1.5 text-[10px] leading-tight"
              activeClassName="font-semibold text-accent-deep"
              idleClassName="font-medium text-ink-soft"
              labelClassName="max-w-full whitespace-nowrap text-center"
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
