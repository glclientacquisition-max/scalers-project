"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLockup } from "@/components/brand/BrandMark";
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

export const DESK_LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/calls", label: "Inbox" },
  { href: "/contacts", label: "Contacts" },
  { href: "/settings", label: "Business" },
  { href: "/wallet", label: "Wallet" },
] as const;

/** Page frame next to the rail. Ticket pages opt into bleed with `data-desk-bleed`. */
export const deskMainClass =
  "mx-auto w-full min-w-0 max-w-desk flex-1 px-4 pt-4 pb-[var(--desk-tabbar-clearance)] sm:px-6 sm:pt-6 md:overflow-y-auto md:p-6 md:has-[[data-desk-bleed]]:h-full md:has-[[data-desk-bleed]]:max-w-none md:has-[[data-desk-bleed]]:overflow-hidden md:has-[[data-desk-bleed]]:p-0";

function pathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SignOutButton({ compact }: { compact?: boolean }) {
  return (
    <form action="/api/logout" method="post">
      <button
        type="submit"
        aria-label="Sign out"
        className={[
          compact
            ? "inline-flex h-12 w-12 items-center justify-center rounded-xl text-ink-soft hover:bg-surface-muted hover:text-warn"
            : "min-h-11 rounded-md px-2 text-sm text-ink-soft hover:text-warn",
          deskShiftClass,
          focusRingVisible,
        ].join(" ")}
      >
        {compact ? (
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
            <path
              d="M8 4.5H4.5v11H8M8.5 10h7M13 7.5 16.5 10 13 12.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          "Sign out"
        )}
      </button>
    </form>
  );
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
  if (name === "Business") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={cls}>
        <path
          d="M4 17V7.5L10 3.5l6 4V17H4Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M8 17v-5h4v5" stroke="currentColor" strokeWidth="1.5" />
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

/** md+ destination rail. Same DESK_LINKS as DeskTabBar. Sign out at the foot. */
export function DeskRail({
  needsCount = 0,
  homeHref = "/home",
}: {
  needsCount?: number;
  homeHref?: string;
}) {
  const pathname = usePathname();

  return (
    <div
      data-desk-rail=""
      className="hidden h-dvh w-[4.5rem] shrink-0 flex-col border-r border-line/80 bg-surface md:flex"
    >
      <div className="flex h-14 items-center justify-center">
        <DeskHint label="Scalers">
          <BrandLockup href={homeHref} name="Scalers" size="sm" markOnly priority />
        </DeskHint>
      </div>
      <nav aria-label="Workspace" className="flex flex-1 flex-col items-center gap-1 px-1.5 pt-1">
        {DESK_LINKS.map((item) => {
          const active = pathActive(pathname, item.href);
          return (
            <DeskHint key={item.href} label={item.label}>
              <Link
                href={item.href}
                aria-label={inboxLinkAria(item.label, needsCount) || item.label}
                aria-current={active ? "page" : undefined}
                className={[
                  "inline-flex h-12 w-12 items-center justify-center rounded-xl",
                  deskShiftClass,
                  focusRingVisible,
                  active
                    ? "bg-accent/10 text-accent-deep"
                    : "text-ink-soft hover:bg-surface-muted hover:text-ink",
                ].join(" ")}
              >
                <TabIconWithBadge name={item.label} count={needsCount} />
              </Link>
            </DeskHint>
          );
        })}
      </nav>
      <div className="flex justify-center pb-3">
        <DeskHint label="Sign out">
          <SignOutButton compact />
        </DeskHint>
      </div>
    </div>
  );
}

/** Phone identity + Sign out. Destinations stay in DeskTabBar. */
export function DeskPhoneHeader({ homeHref = "/home" }: { homeHref?: string }) {
  return (
    <header className="sticky top-0 z-40 isolate border-b border-line/80 bg-surface shadow-none md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <BrandLockup href={homeHref} name="Scalers" size="sm" priority className="max-w-full" />
        <SignOutButton />
      </div>
    </header>
  );
}

/** Phone thumb destinations. Same DESK_LINKS as the desktop rail. */
export function DeskTabBar({ needsCount = 0 }: { needsCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Workspace"
      className="fixed inset-x-0 bottom-0 z-40 isolate min-h-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom,0px))] border-t border-line/80 bg-surface pb-[env(safe-area-inset-bottom)] shadow-none md:hidden"
    >
      <ul className="flex">
        {DESK_LINKS.map((item) => {
          const active = pathActive(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={inboxLinkAria(item.label, needsCount)}
                className={[
                  "flex min-h-12 w-full min-w-0 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 text-[11px] leading-none",
                  deskShiftClass,
                  focusRingVisible,
                  active
                    ? "font-semibold text-accent-deep"
                    : "font-medium text-ink-soft",
                ].join(" ")}
              >
                <TabIconWithBadge name={item.label} count={needsCount} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
