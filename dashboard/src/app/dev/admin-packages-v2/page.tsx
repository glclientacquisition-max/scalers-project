import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { AdminPackagesV2 } from "@/components/admin/v2/AdminPackagesV2";
import { ADMIN_BILLING_TABS } from "@/lib/adminLinks";
import { ADMIN_PACKAGES_V2_CATALOG } from "../fixtures/adminPlans";

export const instant = false;

/** Packages fixture (ADMIN_V2 shell + Billing tabs). DASHBOARD_OPEN=true only. */
export default async function DevAdminPackagesV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminSectionTabs label="Billing" tabs={ADMIN_BILLING_TABS} />
      <AdminPackagesV2 catalog={ADMIN_PACKAGES_V2_CATALOG} readOnlyHint={null} />
    </AdminShell>
  );
}
