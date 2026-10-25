import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminInvoicesV2 } from "@/components/admin/v2/AdminInvoicesV2";
import { ADMIN_INVOICES, ADMIN_INVOICES_NOW } from "../fixtures/adminInvoices";

export const instant = false;

/** Invoices table + pane fixture (ADMIN_V2 shell). DASHBOARD_OPEN=true only. */
export default async function DevAdminInvoicesV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminInvoicesV2 rows={ADMIN_INVOICES} nowIso={ADMIN_INVOICES_NOW} />
    </AdminShell>
  );
}
