import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminBusinessesV2 } from "@/components/admin/v2/AdminBusinessesV2";
import { ADMIN_BUSINESSES, ADMIN_BUSINESS_BADGES, ADMIN_BUSINESS_PANES } from "../fixtures/adminBusinesses";

export const instant = false;

/** Businesses table + pane fixture (ADMIN_V2 shell). DASHBOARD_OPEN=true only. */
export default async function DevAdminBusinessesV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminBusinessesV2 businesses={ADMIN_BUSINESSES} badges={ADMIN_BUSINESS_BADGES} paneFixture={ADMIN_BUSINESS_PANES} />
    </AdminShell>
  );
}
