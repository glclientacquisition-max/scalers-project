"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { focusRingVisible } from "@/components/ui/deskChrome";

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

/**
 * Desktop workspace links plus Sign out (header). Phone destinations live in DeskTabBar.
 */
export function DeskNav() {
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
              className={[
                "rounded-md",
                focusRingVisible,
                active
                  ? "font-semibold text-[#005CCC]"
                  : "font-medium text-ink hover:text-[#005CCC]",
              ].join(" ")}
            >
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
export function DeskTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Workspace"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {DESK_LINKS.map((item) => {
          const active = pathActive(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 text-[11px] leading-none",
                  focusRingVisible,
                  active
                    ? "font-semibold text-[#005CCC]"
                    : "font-medium text-ink-soft",
                ].join(" ")}
              >
                <TabIcon name={item.label} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
