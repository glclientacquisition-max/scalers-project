import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminBillingListPanel } from "@/components/AdminBillingListPanel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { logAdminError } from "@/lib/adminErrors";
import { loadAdminBillingOverview } from "@/lib/adminBilling";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminBillingPage() {
  await requireSuperAdmin();
  let overview;
  try {
    overview = await loadAdminBillingOverview();
  } catch (err) {
    logAdminError("billing", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Billing" subtitle="Packages, minutes, and charges by business." />
      <AdminBillingListPanel overview={overview} />
    </div>
  );
}
