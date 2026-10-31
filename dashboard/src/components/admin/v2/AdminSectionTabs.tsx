"use client";

import { usePathname } from "next/navigation";
import type { AdminTab } from "@/lib/adminLinks";
import { Segmented } from "@/components/ui/Segmented";

/** Tabs for a nav entry with several screens (Billing, Settings). Links, so each tab has its own URL. */
export function AdminSectionTabs({ label, tabs }: { label: string; tabs: readonly AdminTab[] }) {
  const path = usePathname() || "";
  return (
    <div className="ops-theme sticky top-0 z-10 mb-ops-2 shrink-0 bg-canvas">
      <Segmented
        label={label}
        items={tabs.map((t) => ({
          key: t.href,
          label: t.label,
          href: t.href,
          active: path === t.href || path.startsWith(`${t.href}/`),
        }))}
      />
    </div>
  );
}
