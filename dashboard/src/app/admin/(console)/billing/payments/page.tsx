import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPaymentsStatus } from "@/components/AdminPaymentsStatus";
import { AdminPaymentsV2 } from "@/components/admin/v2/AdminPaymentsV2";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadBachsStatus } from "@/lib/adminPayRead";

export const instant = false;

export default async function AdminPaymentsPage() {
  await requireSuperAdmin();
  try {
    const status = await loadBachsStatus();
    if (process.env.ADMIN_V2 === "on") {
      return <AdminPaymentsV2 status={status} />;
    }
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
        Payment status could not be loaded.
      </DeskLoadError>
    );
  }
}
