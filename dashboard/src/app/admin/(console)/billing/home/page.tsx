import { notFound } from "next/navigation";
import { AdminBillingHomeV2 } from "@/components/admin/v2/AdminBillingHomeV2";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadInvoicesV2 } from "@/lib/adminInvoicesV2Load";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** Billing home (ADMIN_V2 only): this month's money and who owes. Read-only. */
export default async function AdminBillingHomePage() {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) notFound();
  try {
    const { rows } = await loadInvoicesV2();
    return <AdminBillingHomeV2 rows={rows} nowIso={new Date().toISOString()} />;
  } catch (err) {
    logAdminError("billing-home-v2", err);
    return <DeskLoadError backHref="/admin" backLabel="Overview">Billing could not be loaded.</DeskLoadError>;
  }
}
