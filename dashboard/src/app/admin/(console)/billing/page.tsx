import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminBillingListPanel } from "@/components/AdminBillingListPanel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { logAdminError } from "@/lib/adminErrors";
import { loadAdminBillingOverview } from "@/lib/adminBilling";
import { loadAdminAttention } from "@/lib/adminPayRead";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminBillingPage() {
  await requireSuperAdmin();
  let overview;
  let attention;
  try {
    [overview, attention] = await Promise.all([loadAdminBillingOverview(), loadAdminAttention()]);
  } catch (err) {
    logAdminError("billing", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Billing" />
      <AdminBillingListPanel
        overview={overview}
        attention={attention.items}
        attentionWarning={attention.warning}
      />
    </div>
  );
}
