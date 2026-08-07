"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/calls", label: "Calls" },
  { href: "/settings", label: "Business" },
  { href: "/wallet", label: "Wallet" },
] as const;

/**
 * Workspace nav: inline links on md+, drawer on small screens.
 */
export function DeskNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <nav className="hidden items-center gap-5 text-sm md:flex">
        {LINKS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "font-semibold text-accent"
                  : "font-medium text-ink hover:text-accent"
              }
            >
              {item.label}
            </Link>
          );
        })}
        <form action="/api/logout" method="post">
          <button type="submit" className="text-ink-soft hover:text-warn">
            Sign out
          </button>
        </form>
      </nav>

      <div className="md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="desk-mobile-nav"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open ? (
        <div
          id="desk-mobile-nav"
          className="absolute inset-x-0 top-full z-50 border-b border-line bg-surface px-4 py-3 shadow-lift md:hidden"
        >
          <nav className="flex flex-col gap-1">
            {LINKS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "rounded-lg px-3 py-2.5 text-sm font-medium",
                    active ? "bg-accent-soft text-accent-deep" : "text-ink hover:bg-surface-muted",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
            <form action="/api/logout" method="post" className="mt-1">
              <button
                type="submit"
                className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-ink-soft hover:bg-surface-muted hover:text-warn"
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      ) : null}
    </>
  );
}
