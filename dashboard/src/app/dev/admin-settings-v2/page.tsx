import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { AdminSettingsHubV2 } from "@/components/admin/v2/AdminSettingsHubV2";
import { ADMIN_SETTINGS_TABS } from "@/lib/adminLinks";

export const instant = false;

/** Settings hub fixture (ADMIN_V2 shell). DASHBOARD_OPEN=true only. */
export default async function DevAdminSettingsV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminSectionTabs label="Settings" tabs={ADMIN_SETTINGS_TABS} />
      <AdminSettingsHubV2
        raw={{ voicemail_hold_days: 7, shadow_invoices: true, billing_notices_send: false, desk_plan_change_enabled: true, new_signup_trial_enabled: true, package_editor_enabled: false, price_change_approval_threshold_kes: 5000, updated_at: "2026-10-18T07:30:00.000Z" }}
      />
    </AdminShell>
  );
}
