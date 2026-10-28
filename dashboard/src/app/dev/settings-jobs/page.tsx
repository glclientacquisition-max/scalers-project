import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BusinessSettingsShell } from "@/components/BusinessSettingsShell";
import { CallsForwardingPanel } from "@/components/CallsForwardingPanel";
import { emptyCallSetup } from "@/lib/callSetupStore";
import { resolveCallSetupStatus } from "@/lib/callSetupStatus";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { devChapterOneTenant } from "@/lib/devChapterOneTenant";
import {
  SETTINGS_NAV,
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
} from "@/lib/businessSettingsNav";
import { settingsIndexStatuses } from "@/lib/settingsOptionStatus";
import type { TenantRow } from "@/lib/supabase";
import { parsePaymentsText } from "@/lib/payments";
import { assistantSayStateFromTenant } from "@/lib/assistantSayVoice.server";
import { AssistantSayPanel } from "@/components/assistantSay/AssistantSayPanel";
import { DeskRoleProvider, ViewOnlyBanner } from "@/components/DeskRole";
import { assistantSayBelowList } from "@/components/assistantSay/AssistantSayExtras";

/**
 * Settings job list and rail. DASHBOARD_OPEN=true only.
 * Phone: /dev/settings-jobs. Wide rail: ?tab=train&panel=hours.
 */
export const instant = false;

const tenant = {
  ...devChapterOneTenant,
  faqs: [
    { question: "Do you print on Sundays?", answer: "Yes, from 10 to 2. Bigger jobs are ready on Monday." },
    {
      question: "Can I pay by M-Pesa?",
      answer:
        "Yes. Use the till number on the counter, then show the message to the cashier before you collect your prints. We also take cash and card for orders over KSh 1,000, and we can send an invoice to your company if you print with us every month.",
    },
  ],
} as TenantRow;

/** Identity (?tab=train&panel=identity): a filled greeting and three public contacts. */
const identityFilled = {
  spoken_name: "Chapter One Books",
  greeting_invite: "Which book are you looking for",
  social_handles: {
    channels: [
      { kind: "phone", label: "Main", value: "+254712345678" },
      { kind: "whatsapp", label: "Orders", value: "+254722000111" },
      { kind: "instagram", label: "Instagram", value: "@chapteronebooks" },
    ],
  },
};

/** ?identity=empty: a new business with no name, greeting, tone or contacts yet. */
const identityEmpty = {
  business_name: "",
  spoken_name: null,
  greeting_invite: null,
  agent_name: "",
  agent_tone: null,
  social_handles: { channels: [] },
};

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
  const policiesT = params.policies === "messy" ? ({ ...base, business_policies: messyPolicies } as TenantRow) : base;
  const identityState = Array.isArray(params.identity) ? params.identity[0] : params.identity;
  const t = (
    identityState === "empty" ? { ...policiesT, ...identityEmpty } : { ...policiesT, ...identityFilled }
  ) as TenantRow;
  const roleRaw = Array.isArray(params.role) ? params.role[0] : params.role;
  const role = roleRaw === "viewer" || roleRaw === "staff" ? roleRaw : null;

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
    tab === "assistant-say" ? (
      <AssistantSayPanel state={assistantSayStateFromTenant(t)} belowList={assistantSayBelowList(t)} />
    ) : null;

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
    <DeskRoleProvider role={role}>
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <ViewOnlyBanner />
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
            businessCategory={identityState === "empty" ? null : "books_stationery"}
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
    </DeskRoleProvider>
  );
}
