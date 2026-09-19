"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

function pathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SignOutButton() {
  return (
    <form action="/api/logout" method="post">
      <button
        type="submit"
        className={[
          "min-h-11 rounded-md px-2 text-sm text-ink-soft hover:text-warn",
          deskShiftClass,
          focusRingVisible,
        ].join(" ")}
      >
        Sign out
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
    <span className="relative inline-flex">
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

/**
 * Desktop workspace links plus Sign out (header). Phone destinations live in DeskTabBar.
 */
export function DeskNav({ needsCount = 0 }: { needsCount?: number }) {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-2 sm:gap-5">
      <nav className="hidden items-center gap-5 text-sm md:flex" aria-label="Workspace">
        {DESK_LINKS.map((item) => {
          const active = pathActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={inboxLinkAria(item.label, needsCount)}
              className={[
                "inline-flex items-center gap-1.5 rounded-md",
                deskShiftClass,
                focusRingVisible,
                active
                  ? "font-semibold text-accent-deep"
                  : "font-medium text-ink hover:text-accent-deep",
              ].join(" ")}
            >
              {item.label === "Inbox" ? (
                <TabIconWithBadge name="Inbox" count={needsCount} />
              ) : null}
              {item.label}
            </Link>
          );
        })}
      </nav>
      <SignOutButton />
    </div>
  );
}

/** Phone thumb destinations. Same DESK_LINKS as the desktop top bar. */
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
