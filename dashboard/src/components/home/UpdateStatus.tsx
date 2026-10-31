"use client";

import { useState } from "react";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { Sheet } from "@/components/ui/Sheet";
import { focusRingVisible } from "@/components/ui/deskChrome";
import { formatBulletinEndLabel, liveBulletinItems } from "@/lib/dailyBulletin";
import type { TenantRow } from "@/lib/supabase";

/** One line when an update is on. Posting opens the existing composer. */
export function UpdateStatus({ tenant }: { tenant: TenantRow }) {
  const live = liveBulletinItems(tenant.daily_bulletin);
  const item = live[0];
  const [open, setOpen] = useState(false);
  if (!item) return null;
  const until = formatBulletinEndLabel(item.ends_at).toLowerCase();
  return (
    <section aria-label="Update">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex min-h-12 w-full items-center rounded-2xl border border-hairline bg-surface px-4 text-start text-body text-ink motion-press ${focusRingVisible}`}
      >
        <span className="min-w-0 truncate">Callers hear: {item.text} · {until}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Update" description="What callers hear">
        <DailyBulletinPanel tenant={tenant} />
      </Sheet>
    </section>
  );
}
