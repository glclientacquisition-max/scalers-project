"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "Overview", exact: true as boolean },
  { href: "/admin/wallets", label: "Wallets", exact: false as boolean },
  { href: "/admin/businesses", label: "Businesses", exact: false as boolean },
  { href: "/admin/numbers", label: "Numbers", exact: false as boolean },
  { href: "/admin/voices", label: "Voices", exact: false as boolean },
];

export function AdminNav({ onDark = false }: { onDark?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap transition",
              onDark
                ? active
                  ? "bg-white/15 text-white"
                  : "text-sky-100/85 hover:bg-white/10 hover:text-white"
                : active
                  ? "bg-accent-soft text-accent-deep"
                  : "text-ink hover:bg-surface-muted",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
