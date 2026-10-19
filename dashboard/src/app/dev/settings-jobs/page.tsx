import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import { CallsForwardingPanel } from "@/components/CallsForwardingPanel";
import { emptyCallSetup } from "@/lib/callSetupStore";
import { resolveCallSetupStatus } from "@/lib/callSetupStatus";
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
import { assistantSayStateFromTenant } from "@/lib/assistantSayLoad";
import { AssistantSayPanel } from "@/components/assistantSay/AssistantSayPanel";

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

/** ?policies=messy: starter lines, a line written for the assistant, and old text with stray punctuation. */
const messyPolicies = {
  ...tenant.business_policies,
  payment: "M-Pesa and cash. Confirm other methods with the team if asked.",
  payments: parsePaymentsText("M-Pesa and cash. Confirm other methods with the team if asked."),
  delivery: "Same-day Nairobi delivery for stocked items when available; countrywide shipping on request.",
  deposit: "We can hold items for pickup when we have the caller name and pickup time.",
  cancellation: ": Orders can be cancelled before we print..",
  warranty: "The receptionist should route the caller to Amina for warranty questions.",
};

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
  const tab = parseBusinessSettingsTab(tabRaw, panelRaw);
  const trainPanel = parseBusinessSettingsPanel(panelRaw, tabRaw);
  const base = params.vertical === "home_services" ? homeTenant : tenant;
  const t = params.policies === "messy" ? ({ ...base, business_policies: messyPolicies } as TenantRow) : base;

  const curatedVoices = [
    {
      id: "7b197f3c-84b4-4404-986f-114e4dac1432",
      description: "Warm Kenyan receptionist tone",
      default: true,
    },
    { id: "dev-voice-clear", description: "Clear and brief" },
    { id: "dev-voice-calm", description: "Calm and slow" },
  ];

  // Calls & forwarding (?tab=calls): forwarding on Airtel, proven by a test call 2 days ago.
  const now = Date.now();
  const callSetup = {
    ...emptyCallSetup(),
    option: "forward" as const,
    network: "airtel" as const,
    opened_at: new Date(now - 3 * 86_400_000).toISOString(),
    // "Forwarding works": the test call from a teammate's phone came in 2 days ago.
    test_from: "+254722000111",
    test_started_at: new Date(now - 2 * 86_400_000 - 120_000).toISOString(),
  };
  const assistantSaySlot =
    tab === "assistant-say" ? <AssistantSayPanel state={assistantSayStateFromTenant(t)} /> : null;

  const callsSlot =
    tab === "calls" ? (
      <CallsForwardingPanel
        tenantId={t.id}
        number="0700000000"
        pretty="+254 700 000 000"
        supported
        setup={callSetup}
        status={resolveCallSetupStatus({
          numberReady: true,
          setup: callSetup,
          activity: {
            testMatchAt: new Date(now - 2 * 86_400_000).toISOString(),
            firstCallAfterOpenAt: new Date(now - 2 * 86_400_000).toISOString(),
            lastCallAt: new Date(now - 86_400_000).toISOString(),
          },
          now,
        })}
      />
    ) : null;

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
            callsSlot={callsSlot}
            assistantSaySlot={assistantSaySlot}
            assistantSayPage
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
