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
import { parsePaymentsText } from "@/lib/payments";

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
  soniox_voice_id: "7b197f3c-84b4-4404-986f-114e4dac1432",
  vertical: "retail",
  team_directory: [{ name: "Amina", role: "Desk", phone: "+254700000001" }],
  faqs: [
    { question: "Do you print on Sundays?", answer: "Yes, from 10 to 2. Bigger jobs are ready on Monday." },
    { question: "Can I pay by M-Pesa?", answer: "Yes. Use the till number on the counter, then show the message to the cashier before you collect your prints. We also take cash and card for orders over KSh 1,000, and we can send an invoice to your company if you print with us every month." },
  ],
  business_locations: [{ label: "Westlands", address: "Opposite Naivas" }],
  // Old free text plus payments read from it (unconfirmed), as an owner upgrading sees it.
  business_policies: {
    payment: "M-Pesa till 123456 or cash on delivery",
    payments: parsePaymentsText("M-Pesa till 123456 or cash on delivery"),
    returns: "Unused within 7 days with receipt",
    extra: { "Minimum order": "KSh 500" },
  },
  is_active: true,
} as TenantRow;

const homeTenant = {
  ...tenant,
  id: "dev-settings-jobs-home",
  business_name: "Done and Dusted Cleaning",
  vertical: "home_services",
  business_policies: {
    payment: "Paybill 542542 account your name. 50% deposit before we start",
    payments: parsePaymentsText("Paybill 542542 account your name. 50% deposit before we start"),
    coverage_areas: ["Nairobi"],
  },
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
  const t = params.vertical === "home_services" ? homeTenant : tenant;

  const curatedVoices = [
    {
      id: "7b197f3c-84b4-4404-986f-114e4dac1432",
      description: "Warm Kenyan receptionist tone",
      default: true,
    },
    { id: "dev-voice-clear", description: "Clear and brief" },
    { id: "dev-voice-calm", description: "Calm and slow" },
  ];

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <BusinessSettingsShell
            tenant={t}
            tab={tab}
            trainPanel={trainPanel}
            curatedVoices={curatedVoices}
            optionStatus={settingsIndexStatuses(
              t,
              curatedVoices,
              SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.target))
            )}
          />
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
