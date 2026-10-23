"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminTab } from "@/lib/adminLinks";

/** Tabs for a nav entry with several screens (Billing, Settings). Links, so each tab has its own URL. */
export function AdminSectionTabs({ label, tabs }: { label: string; tabs: readonly AdminTab[] }) {
  const path = usePathname() || "";
  const current = tabs.find((t) => path === t.href || path.startsWith(`${t.href}/`));
  return (
    <nav aria-label={label} className="ops-theme -mx-1 mb-ops-2 flex items-center gap-1 overflow-x-auto border-b border-hairline px-1">
      {tabs.map((t) => {
        const on = path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={[
              "inline-flex h-9 shrink-0 items-center border-b-2 px-ops-3 text-ops-body",
              on ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
      <span className="ms-auto hidden shrink-0 px-ops-3 text-ops-label text-ink-2 md:inline">
        {label} · {current?.label ?? tabs[0]?.label}
      </span>
    </nav>
  );
}
