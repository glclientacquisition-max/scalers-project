import { AdminInvoiceList } from "@/components/AdminInvoiceList";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadAdminInvoices } from "@/lib/adminPayRead";
import { AdminInvoicesV2 } from "@/components/admin/v2/AdminInvoicesV2";
import { loadInvoicesV2 } from "@/lib/adminInvoicesV2Load";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  await requireSuperAdmin();
  const businessId = ((await searchParams).business || "").trim() || null;
  if (isAdminV2Enabled()) {
    try {
      const { rows, truncated } = await loadInvoicesV2(businessId);
      const named = businessId ? rows[0]?.businessName ?? null : null;
      return <AdminInvoicesV2 rows={rows} truncated={truncated} businessName={named} nowIso={new Date().toISOString()} />;
    } catch (err) {
      logAdminError("billing-invoices-v2", err);
      return (
        <DeskLoadError backHref="/admin/billing" backLabel="Billing">
          Invoices could not be loaded.
        </DeskLoadError>
      );
    }
  }
  try {
    const list = await loadAdminInvoices(businessId);
    return (
      <div className="space-y-4">
        <AdminPageHeader title="Invoices" subtitle="SCL numbers, what was paid, and what is still due." />
        <AdminInvoiceList rows={list.rows} truncated={list.truncated} businessName={list.businessName} />
      </div>
    );
  } catch (err) {
    logAdminError("billing-invoices", err);
    return (
      <DeskLoadError backHref="/admin/billing" backLabel="Billing">
        Invoices could not be loaded.
      </DeskLoadError>
    );
  }
}
