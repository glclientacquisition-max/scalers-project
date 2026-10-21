import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminInvoiceDetail } from "@/components/AdminInvoiceDetail";
import { AdminShell } from "@/components/AdminNav";
import { ADMIN_INVOICE } from "../fixtures/adminBilling";

/** Invoice detail fixture. DASHBOARD_OPEN=true only. */
export default function DevAdminInvoicePage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();

  return (
    <AdminShell operatorName="alvin">
      <AdminPageHeader title={ADMIN_INVOICE.number} subtitle="Lines, payments, checkouts, and receipts." />
      <AdminInvoiceDetail invoice={ADMIN_INVOICE} />
    </AdminShell>
  );
}
