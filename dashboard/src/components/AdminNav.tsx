"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";

const NAV = [
  { href: "/admin", label: "Overview", exact: true as boolean },
  { href: "/admin/wallets", label: "Wallets", exact: false as boolean },
  { href: "/admin/packages", label: "Packages", exact: false as boolean },
  { href: "/admin/businesses", label: "Businesses", exact: false as boolean },
  { href: "/admin/numbers", label: "Numbers", exact: false as boolean },
  { href: "/admin/voices", label: "Voices", exact: false as boolean },
];

function routeActive(pathname: string, href: string, exact: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Highlights this link before the admin history update. Own state: Super Admin is not the owner desk. */
function AdminLinkPending({
  href,
  setPendingHref,
}: {
  href: string;
  setPendingHref: (value: string | null | ((current: string | null) => string | null)) => void;
}) {
  const { pending } = useLinkStatus();
  useLayoutEffect(() => {
    if (pending) {
      setPendingHref(href);
      return;
    }
    setPendingHref((current) => (current === href ? null : current));
  }, [pending, href, setPendingHref]);
  return null;
}

export function AdminNav({ onDark = false }: { onDark?: boolean }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Super Admin">
      {NAV.map((item) => {
        const active = pendingHref
          ? pendingHref === item.href
          : routeActive(pathname, item.href, item.exact);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap lg:w-full",
              deskShiftClass,
              onDark
                ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-brand-900"
                : focusRingVisible,
              onDark
                ? active
                  ? "bg-white/15 text-white"
                  : "text-sky-100/85 hover:bg-white/10 hover:text-white"
                : active
                  ? "bg-accent-soft text-accent-deep"
                  : "text-ink hover:bg-surface-muted",
            ].join(" ")}
          >
            <AdminLinkPending href={item.href} setPendingHref={setPendingHref} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
