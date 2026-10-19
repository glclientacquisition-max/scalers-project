import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminInvoiceList } from "@/components/AdminInvoiceList";
import { AdminShell } from "@/components/AdminNav";
import { ADMIN_INVOICES } from "../fixtures/adminBilling";

/** Invoice list fixture. DASHBOARD_OPEN=true only. */
export default function DevAdminInvoicesPage() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();

  return (
    <AdminShell operatorName="alvin">
      <AdminPageHeader title="Invoices" subtitle="SCL numbers, what was paid, and what is still due." />
      <AdminInvoiceList rows={ADMIN_INVOICES} />
    </AdminShell>
  );
}
