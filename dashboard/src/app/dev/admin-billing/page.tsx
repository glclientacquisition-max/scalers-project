import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminBillingListPanel } from "@/components/AdminBillingListPanel";
import { AdminShell } from "@/components/AdminNav";
import { ADMIN_BILLING_OVERVIEW } from "../fixtures/adminBilling";

/** Billing queue fixture. DASHBOARD_OPEN=true only. */
export default function DevAdminBillingPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();

  return (
    <AdminShell operatorName="alvin">
      <AdminPageHeader title="Billing" />
      <AdminBillingListPanel overview={ADMIN_BILLING_OVERVIEW} />
    </AdminShell>
  );
}
