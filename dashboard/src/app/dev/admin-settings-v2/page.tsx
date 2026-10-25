import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { AdminSettingsHubV2 } from "@/components/admin/v2/AdminSettingsHubV2";
import { ADMIN_SETTINGS_TABS } from "@/lib/adminLinks";

export const instant = false;

/** Settings hub fixture (ADMIN_V2 shell). DASHBOARD_OPEN=true only. */
export default async function DevAdminSettingsV2Page({ searchParams }: { searchParams: Promise<{ env?: string }> }) {
  const sp = await searchParams;
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminSectionTabs label="Settings" tabs={ADMIN_SETTINGS_TABS} />
      <AdminSettingsHubV2
        raw={{ updated_at: "2026-10-18T07:30:00.000Z", hold_winback_enabled: true, number_hold_days: 14, reactivation_fee_kes: null, holdColumns: sp.env !== "prod" }}
      />
    </AdminShell>
  );
}
