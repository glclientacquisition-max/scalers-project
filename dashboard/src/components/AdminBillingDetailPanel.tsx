"use client";

import { type AdminBillingClientDetail } from "@/lib/adminBilling";
import { ButtonLink } from "@/components/ui/Button";
import { AdminShopMoneyPanel } from "@/components/AdminShopMoneyPanel";

/** Dev fixture and legacy embed. Checkout review lives in shop Money. */
export function AdminBillingDetailPanel({ detail }: { detail: AdminBillingClientDetail }) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3 px-4">
        <ButtonLink href={`/admin/businesses/${detail.row.id}?money=1`} variant="ghost">
          Open shop
        </ButtonLink>
        <ButtonLink href="/admin/billing" variant="ghost">
          Billing queue
        </ButtonLink>
      </div>

      <section className="space-y-1">
        <h2 className="px-4 text-caption text-ink-3">Money</h2>
        <ul className="divide-y divide-hairline">
          <AdminShopMoneyPanel detail={detail} />
        </ul>
      </section>
    </div>
  );
}
