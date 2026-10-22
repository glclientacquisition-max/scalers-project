import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminInvoicesV2 } from "@/components/admin/v2/AdminInvoicesV2";
import { AdminCommandPalette } from "@/components/admin/v2/AdminCommandPalette";
import { ADMIN_INVOICES, ADMIN_INVOICES_NOW } from "../fixtures/adminInvoices";
import { ADMIN_SEARCH_HITS } from "../fixtures/adminSearch";

export const instant = false;

/** ⌘K palette open over the invoices fixture (ADMIN_V2 shell). DASHBOARD_OPEN=true only. ?q= sets the query. */
export default async function DevAdminSearchV2Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const q = (await searchParams).q ?? "kil";
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminInvoicesV2 rows={ADMIN_INVOICES} nowIso={ADMIN_INVOICES_NOW} />
      <AdminCommandPalette fixture={ADMIN_SEARCH_HITS} defaultOpen defaultQuery={q} trigger="none" />
    </AdminShell>
  );
}
