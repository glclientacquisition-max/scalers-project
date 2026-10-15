import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminBillingListPanel } from "@/components/AdminBillingListPanel";
import { deskListTitleClass } from "@/components/ui/deskChrome";
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
      <h1 className={deskListTitleClass}>Billing</h1>
      <AdminBillingListPanel overview={overview} />
    </div>
  );
}
