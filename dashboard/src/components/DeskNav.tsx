"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/calls", label: "Calls" },
  { href: "/requests", label: "Requests" },
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

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
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
          <button type="submit" className="min-h-11 text-ink-soft hover:text-warn">
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
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-3 text-sm font-medium text-ink"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            id="desk-mobile-nav"
            className="absolute inset-x-0 top-full z-50 border-b border-line bg-surface px-4 py-3 shadow-lift md:hidden"
          >
            <nav className="flex flex-col gap-1">
              {LINKS.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "rounded-lg px-3 py-3 text-sm font-medium min-h-11 flex items-center",
                      active
                        ? "bg-accent-soft text-accent-deep"
                        : "text-ink hover:bg-surface-muted",
                    ].join(" ")}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <form action="/api/logout" method="post" className="mt-1">
                <button
                  type="submit"
                  className="flex min-h-11 w-full items-center rounded-lg px-3 py-3 text-left text-sm text-ink-soft hover:bg-surface-muted hover:text-warn"
                >
                  Sign out
                </button>
              </form>
            </nav>
          </div>
        </>
      ) : null}
    </>
  );
}
