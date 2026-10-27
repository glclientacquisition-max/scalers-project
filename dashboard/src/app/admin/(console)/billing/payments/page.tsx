import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPaymentsStatus } from "@/components/AdminPaymentsStatus";
import { AdminPaymentsV2 } from "@/components/admin/v2/AdminPaymentsV2";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadBachsStatus } from "@/lib/adminPayRead";
import { loadPaymentsV2 } from "@/lib/adminPaymentsV2Load";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

export default async function AdminPaymentsPage() {
  await requireSuperAdmin();
  try {
    if (isAdminV2Enabled()) {
      const { rows, truncated } = await loadPaymentsV2();
      return <AdminPaymentsV2 rows={rows} truncated={truncated} nowIso={new Date().toISOString()} />;
    }
    const status = await loadBachsStatus();
    return (
      <div className="space-y-4">
        <AdminPageHeader title="Payments" subtitle="Payment status." />
        <AdminPaymentsStatus status={status} />
      </div>
    );
  } catch (err) {
    logAdminError("billing-payments", err);
    return (
      <DeskLoadError backHref="/admin/billing" backLabel="Billing">
        Payments could not be loaded.
      </DeskLoadError>
    );
  }
}
