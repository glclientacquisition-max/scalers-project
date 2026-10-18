"use client";

import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/ui/Button";
import type { BillingBanner } from "@/lib/billingBanner";

export function BillingNote({ banner, bar = false }: { banner: BillingBanner; bar?: boolean }) {
  return (
    <div
      role="status"
      data-billing-banner=""
      className={
        bar
          ? "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline bg-attention-tonal px-4 py-2 text-start"
          : "mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-attention-tonal px-4 py-3 text-start"
      }
    >
      <p className="min-w-0 flex-1 text-body text-ink">{banner.text}</p>
      {banner.action ? (
        <ButtonLink href={banner.action.href} variant="tonal" size="sm">
          {banner.action.label}
        </ButtonLink>
      ) : null}
    </div>
  );
}

/** Desk banner under the header. Hidden on Plan and Billing, which show their own. */
export function DeskBillingBanner({ banner }: { banner: BillingBanner }) {
  const path = usePathname() || "";
  if (path.startsWith("/settings/plan") || path.startsWith("/settings/billing")) return null;
  return <BillingNote banner={banner} bar />;
}
