import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { AdminServicesV2 } from "@/components/admin/v2/AdminServicesV2";
import { ADMIN_SETTINGS_TABS } from "@/lib/adminLinks";
import { ADMIN_SERVICES_SNAPSHOT } from "../fixtures/adminServices";

export const instant = false;

/** Services fixture (ADMIN_V2 shell + Settings tabs). DASHBOARD_OPEN=true only. */
export default async function DevAdminServicesV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminSectionTabs label="Settings" tabs={ADMIN_SETTINGS_TABS} />
      <AdminServicesV2 snapshot={ADMIN_SERVICES_SNAPSHOT} />
    </AdminShell>
  );
}
