import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { defaultHoursSchedule } from "@/lib/hoursSchedule";
import { SETTINGS_NAV, parseBusinessSettingsTab } from "@/lib/businessSettingsNav";
import { settingsIndexStatuses } from "@/lib/settingsOptionStatus";
import type { TenantRow } from "@/lib/supabase";

/** Catalogue stamps and Sheet import. DASHBOARD_OPEN=true only. */
const tenant = {
  id: "dev-settings-catalog",
  business_name: "Chapter One",
  sautikit_virtual_number: "+254700000000",
  whatsapp_notification_number: "+254700000000",
  llm_system_prompt: "Chapter One answers the phone.",
  vertical: "retail",
  services_offered: "Print and delivery",
  services_catalog: [
    {
      name: "Carpet cleaning",
      price_range: "",
      notes: "Quote on request",
      out_of_scope: "",
      in_stock: "",
      category: "",
      pricing_mode: "ask",
      source: "import",
    },
    {
      name: "Home cleaning",
      price_range: "from 2,500 KES",
      notes: "",
      out_of_scope: "",
      in_stock: "",
      category: "",
      pricing_mode: "from",
      source: "owner",
    },
  ],
  product_catalog: [
    {
      name: "96 page exercise book",
      sku: "1",
      category: "Stationery",
      price: "450 KES",
      unit: "",
      in_stock: "yes",
      notes: "",
      aliases: ["96pg exe book"],
      source: "import",
      price_mode: "fixed",
    },
    {
      name: "Atomic Habits",
      sku: "2",
      category: "Self-help",
      price: "2,500 KES",
      unit: "",
      in_stock: "no",
      notes: "",
      aliases: [],
      source: "owner",
      holdable: true,
    },
  ],
  business_hours: "Mon to Sat, 8 to 6",
  hours_schedule: defaultHoursSchedule("Westlands"),
  agent_name: "Aisha",
  agent_tone: "warm",
  soniox_voice_id: "7b197f3c-84b4-4404-986f-114e4dac1432",
  team_directory: [],
  faqs: [],
  business_locations: [],
  is_active: true,
} as unknown as TenantRow;

export default async function DevSettingsCatalogPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }
  const tab = parseBusinessSettingsTab("catalog");
  const curatedVoices = [
    {
      id: "7b197f3c-84b4-4404-986f-114e4dac1432",
      description: "Warm Kenyan receptionist tone",
      default: true,
    },
  ];
  const navTargets = SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.target));

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <BusinessSettingsShell
            tenant={tenant}
            tab={tab}
            trainPanel="identity"
            curatedVoices={curatedVoices}
            optionStatus={settingsIndexStatuses(tenant, curatedVoices, navTargets)}
          />
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
