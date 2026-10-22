import { redirect } from "next/navigation";
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
  // ADMIN_V2: Billing opens on Invoices; this list's views move to Overview and Invoices.
  if (process.env.ADMIN_V2 === "on") redirect("/admin/billing/invoices");
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
