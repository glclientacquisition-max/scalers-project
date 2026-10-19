import { AdminInvoiceList } from "@/components/AdminInvoiceList";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadAdminInvoices } from "@/lib/adminPayRead";

export const instant = false;

export default async function AdminInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  await requireSuperAdmin();
  const businessId = ((await searchParams).business || "").trim() || null;
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
