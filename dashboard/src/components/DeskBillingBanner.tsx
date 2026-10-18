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
          ? "border-b border-hairline bg-surface-2 px-4 py-2 text-center"
          : "mt-4 rounded-xl bg-surface-2 px-4 py-3"
      }
    >
      <p className="text-body text-ink">{banner.text}</p>
      {banner.action ? (
        <div className={bar ? "mt-2" : "mt-3"}>
          <ButtonLink href={banner.action.href} variant="tonal" size="sm">
            {banner.action.label}
          </ButtonLink>
        </div>
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
