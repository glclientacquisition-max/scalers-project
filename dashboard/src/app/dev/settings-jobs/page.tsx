import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { defaultHoursSchedule } from "@/lib/hoursSchedule";
import {
  SETTINGS_NAV,
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
} from "@/lib/businessSettingsNav";
import { settingsIndexStatuses } from "@/lib/settingsOptionStatus";
import type { TenantRow } from "@/lib/supabase";

/**
 * Settings job list and rail. DASHBOARD_OPEN=true only.
 * Phone: /dev/settings-jobs. Wide rail: ?tab=train&panel=hours.
 */
const tenant = {
  id: "dev-settings-jobs",
  business_name: "Chapter One",
  sautikit_virtual_number: "+254700000000",
  whatsapp_notification_number: "+254700000000",
  alert_email: "",
  notify_channels: { sms: true, whatsapp: true, email: false },
  llm_system_prompt: "Chapter One answers the phone.",
  services_offered: "Prints",
  services_catalog: [{ name: "A4 print", price_range: "20", notes: "", out_of_scope: "" }],
  product_catalog: [],
  business_hours: "Mon to Sat, 8 to 6",
  hours_schedule: defaultHoursSchedule("Westlands"),
  agent_name: "Aisha",
  agent_tone: "warm",
  vertical: "retail",
  team_directory: [{ name: "Amina", role: "Desk", phone: "+254700000001" }],
  faqs: [],
  business_locations: [{ label: "Westlands", address: "Opposite Naivas" }],
  is_active: true,
} as TenantRow;

type DevSettingsJobsProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DevSettingsJobsPage({ searchParams }: DevSettingsJobsProps) {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  const params = (await searchParams) || {};
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const panelRaw = Array.isArray(params.panel) ? params.panel[0] : params.panel;
  const tab = parseBusinessSettingsTab(tabRaw);
  const trainPanel = parseBusinessSettingsPanel(panelRaw, tabRaw);

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <BusinessSettingsShell
            tenant={tenant}
            tab={tab}
            trainPanel={trainPanel}
            optionStatus={settingsIndexStatuses(
              tenant,
              [],
              SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.target))
            )}
          />
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
