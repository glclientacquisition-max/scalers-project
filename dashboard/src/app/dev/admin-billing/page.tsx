import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminBillingListPanel } from "@/components/AdminBillingListPanel";
import { AdminShell } from "@/components/AdminNav";
import { ADMIN_ATTENTION, ADMIN_BILLING_OVERVIEW } from "../fixtures/adminBilling";

/** Billing queue fixture. DASHBOARD_OPEN=true only. */
export default async function DevAdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const view = (await searchParams).view;

  return (
    <AdminShell operatorName="alvin">
      <AdminPageHeader title="Billing" subtitle="Platform queue, mix, and minutes." />
      <AdminBillingListPanel
        overview={ADMIN_BILLING_OVERVIEW}
        attention={ADMIN_ATTENTION}
        initialFilter={view === "attention" ? "attention" : "needs"}
      />
    </AdminShell>
  );
}
