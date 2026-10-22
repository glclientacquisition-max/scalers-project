import { requireSuperAdmin } from "@/lib/adminGuard";
import type { ReactNode } from "react";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { ADMIN_BILLING_TABS } from "@/lib/adminLinks";

/** Billing tabs under ADMIN_V2. The old shell renders its pages unchanged. */
export default async function BillingLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 !== "on") return children;
  return (
    <>
      <AdminSectionTabs label="Billing" tabs={ADMIN_BILLING_TABS} />
      {children}
    </>
  );
}
