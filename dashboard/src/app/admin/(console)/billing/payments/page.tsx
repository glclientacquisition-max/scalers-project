import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPaymentsStatus } from "@/components/AdminPaymentsStatus";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadBachsStatus } from "@/lib/adminPayRead";

export const instant = false;

export default async function AdminPaymentsPage() {
  await requireSuperAdmin();
  try {
    const status = await loadBachsStatus();
    return (
      <div className="space-y-4">
        <AdminPageHeader title="Payments" subtitle="Bachs status. Collections stay off." />
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
