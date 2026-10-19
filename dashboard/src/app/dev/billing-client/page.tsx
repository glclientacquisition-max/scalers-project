import { notFound } from "next/navigation";
import { AdminBillingDetailPanel } from "@/components/AdminBillingDetailPanel";
import { ADMIN_BILLING_DETAIL } from "../fixtures/adminBilling";

export default function DevBillingClientPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-display text-page">{ADMIN_BILLING_DETAIL.row.business_name}</h1>
        <AdminBillingDetailPanel detail={ADMIN_BILLING_DETAIL} />
      </div>
    </main>
  );
}
