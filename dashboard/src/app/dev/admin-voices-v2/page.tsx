import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminSectionTabs } from "@/components/admin/v2/AdminSectionTabs";
import { AdminVoicesV2 } from "@/components/admin/v2/AdminVoicesV2";
import { ADMIN_SETTINGS_TABS } from "@/lib/adminLinks";
import type { PlatformSonioxVoiceRow } from "@/lib/sonioxVoiceCatalog";

export const instant = false;

const BASE: PlatformSonioxVoiceRow[] = [
  { id: "v1", description: "Warm Kenyan receptionist", is_default: true, is_active: true, sort_order: 1 },
  { id: "v2", description: "Clear Nairobi front desk", is_default: false, is_active: true, sort_order: 2 },
  { id: "v3", description: "Quiet evening tone", is_default: false, is_active: false, sort_order: 3 },
  { id: "v4", description: "Bright clinic greeting", is_default: false, is_active: true, sort_order: 4 },
  { id: "v5", description: "Calm booking desk", is_default: false, is_active: true, sort_order: 5 },
  { id: "v6", description: "Firm collections line", is_default: false, is_active: false, sort_order: 6 },
];

const VOICES: PlatformSonioxVoiceRow[] = [
  ...BASE,
  ...Array.from({ length: 18 }, (_, i) => ({
    id: `vx${i}`,
    description: `Desk tone ${i + 7}`,
    is_default: false,
    is_active: i % 3 !== 0,
    sort_order: i + 7,
  })),
];

/** Voices fixture (ADMIN_V2 shell + Settings tabs). DASHBOARD_OPEN=true only. */
export default async function DevAdminVoicesV2Page() {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <AdminShell operatorName="alvin" v2>
      <AdminSectionTabs label="Settings" tabs={ADMIN_SETTINGS_TABS} />
      <AdminVoicesV2 voices={VOICES} />
    </AdminShell>
  );
}
