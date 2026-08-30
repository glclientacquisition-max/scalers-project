"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DESK_MOBILE_MORE,
  DESK_MOBILE_PRIMARY,
  DESK_NAV_LINKS,
  isDeskHrefActive,
  isDeskMoreActive,
} from "@/lib/deskNav";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40";

function SignOutButton({ className }: { className: string }) {
  return (
    <form action="/api/logout" method="post">
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}

/**
 * Desktop workspace nav. Six text destinations plus Sign out.
 */
export function DeskNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Workspace" className="hidden items-center gap-5 text-sm md:flex">
      {DESK_NAV_LINKS.map((item) => {
        const active = isDeskHrefActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? `rounded-md font-semibold text-accent ${FOCUS}`
                : `rounded-md font-medium text-ink hover:text-accent ${FOCUS}`
            }
          >
            {item.label}
          </Link>
        );
      })}
      <SignOutButton
        className={`min-h-11 rounded-md text-ink-soft hover:text-warn ${FOCUS}`}
      />
    </nav>
  );
}

/**
 * Mobile workspace nav. Persistent labeled bar; More holds secondary destinations.
 * Must render outside the blurred header so `fixed` is viewport-relative.
 */
export function DeskMobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = isDeskMoreActive(pathname);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 md:hidden">
      {moreOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setMoreOpen(false)}
        />
      ) : null}

      <div
        id="desk-more-nav"
        hidden={!moreOpen}
        className="relative z-50 border-t border-line bg-surface px-4 py-2"
      >
        <nav aria-label="More" className="flex flex-col">
          {DESK_MOBILE_MORE.map((item) => {
            const active = isDeskHrefActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  `flex min-h-12 items-center rounded-lg px-3 text-sm font-medium ${FOCUS}`,
                  active
                    ? "bg-accent-soft text-accent-deep"
                    : "text-ink hover:bg-surface-muted",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
          <SignOutButton
            className={`flex min-h-12 w-full items-center rounded-lg px-3 text-left text-sm text-ink-soft hover:bg-surface-muted hover:text-warn ${FOCUS}`}
          />
        </nav>
      </div>

      <nav
        aria-label="Workspace"
        className="relative z-50 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="mx-auto flex max-w-desk">
          {DESK_MOBILE_PRIMARY.map((item) => {
            const active = isDeskHrefActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  `flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center px-1 text-[13px] leading-tight ${FOCUS}`,
                  active
                    ? "border-t-2 border-[#0096FF] font-semibold text-accent"
                    : "border-t-2 border-transparent font-medium text-ink-soft",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="desk-more-nav"
            onClick={() => setMoreOpen((v) => !v)}
            className={[
              `flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center px-1 text-[13px] leading-tight ${FOCUS}`,
              moreActive || moreOpen
                ? "border-t-2 border-[#0096FF] font-semibold text-accent"
                : "border-t-2 border-transparent font-medium text-ink-soft",
            ].join(" ")}
          >
            More
          </button>
        </div>
      </nav>
    </div>
  );
}
