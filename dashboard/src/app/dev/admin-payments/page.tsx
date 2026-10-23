import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { AdminPaymentsV2 } from "@/components/admin/v2/AdminPaymentsV2";
import { ADMIN_BILLING_TABS } from "@/lib/adminLinks";
import { ADMIN_BACHS_STATUS } from "../fixtures/adminBilling";

export const instant = false;

/** Payments fixture (ADMIN_V2 shell + Billing tabs). DASHBOARD_OPEN=true only. */
export default async function DevAdminPaymentsPage() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminSectionTabs label="Billing" tabs={ADMIN_BILLING_TABS} />
      <AdminPaymentsV2 status={ADMIN_BACHS_STATUS} />
    </AdminShell>
  );
}
