import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminUsageV2 } from "@/components/admin/v2/AdminUsageV2";
import { UsageSkeleton } from "@/components/admin/v2/UsageSkeleton";
import { ADMIN_USAGE, ADMIN_USAGE_NOW } from "../fixtures/adminUsage";

export const instant = false;

/** Usage drill-down fixture (ADMIN_V2 shell). ?loading=1 shows the skeleton. DASHBOARD_OPEN=true only. */
export default async function DevAdminUsageV2Page({ searchParams }: { searchParams: Promise<{ loading?: string }> }) {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const loading = (await searchParams).loading === "1";
  return (
    <AdminShell operatorName="alvin" v2>
      {loading ? <UsageSkeleton /> : <AdminUsageV2 data={ADMIN_USAGE} tenantId="00000000-0000-4000-8000-000000000001" currentPeriod nowIso={ADMIN_USAGE_NOW} />}
    </AdminShell>
  );
}
