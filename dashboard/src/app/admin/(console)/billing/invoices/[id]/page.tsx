import { notFound } from "next/navigation";
import { AdminInvoiceDetail } from "@/components/AdminInvoiceDetail";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadAdminInvoice } from "@/lib/adminPayRead";

export const instant = false;

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  let invoice;
  try {
    invoice = await loadAdminInvoice(id);
  } catch (err) {
    logAdminError("billing-invoice", err);
    return (
      <DeskLoadError backHref="/admin/billing/invoices" backLabel="Invoices">
        This invoice could not be loaded.
      </DeskLoadError>
    );
  }
  if (!invoice) notFound();

  return (
    <div className="space-y-4">
      <AdminPageHeader title={invoice.number} subtitle="Lines, payments, checkouts, and receipts." />
      <AdminInvoiceDetail invoice={invoice} />
    </div>
  );
}
