import { RoleGate } from "@/components/DeskRole";
import { HomeCallSetupCard } from "@/components/HomeCallSetupCard";
import { HomeGetReadyCallsCard } from "@/components/HomeGetReadyCallsCard";
import { HomeUsageSection } from "@/components/HomeUsageSection";
import type { MinutesMeterMode } from "@/lib/minutesMeter";
import { CallInsights } from "@/components/insights/CallInsights";
import { HomeInsightsError } from "@/components/home/HomeInsightsError";
import { OverviewDataChecksCard } from "@/components/structured/OverviewDataChecksCard";
import { dataChecksFor } from "@/components/structured/StructuredSettingsSlots";
import { areaConfirmCheck } from "@/lib/areaConfirmCheck.server";
import { loadReadyChecklist } from "@/lib/assistantSayVoice.server";
import { lowBalanceNotice } from "@/lib/billingStateModel";
import { loadOwnerBillingView } from "@/lib/billingStateLoad";
import { loadCallInsights } from "@/lib/callInsightsLoad";
import { loadCallSetupState } from "@/lib/callSetupServer";
import { resolveCallSetupStatus } from "@/lib/callSetupStatus";
import { deskAssistantSayPage, factSaveIsConfirm } from "@/lib/deskFeatureFlags";
import { messageCreditsUsage } from "@/lib/messageCredits";
import { minuteMeter } from "@/lib/minutes";
import { loadUsageBillingExtras } from "@/lib/ownerPlanLoad";
import { loadOwnerPackageMeter } from "@/lib/packageCatalog";
import type { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { homeMinuteStatus } from "@/lib/usageCap";

/**
 * Overview parts that stream in on their own (D2). The Work list, Today and
 * Line paint as soon as the inbox loads; each slot below sits in its own
 * Suspense so a slow billing, insights or call setup query never holds the
 * page. Same loaders and props as before; only the waiting moved.
 */

type HomeTenant = NonNullable<Awaited<ReturnType<typeof getCurrentTenant>>>;
type HomeClient = NonNullable<Awaited<ReturnType<typeof createWorkspaceDataClient>>>["client"];

/** Aside usage block: minutes left, plan line, low notice. */
export async function HomeUsageSlot({ tenant, isBeta }: { tenant: HomeTenant; isBeta: boolean }) {
  const [billing, extras] = await Promise.all([
    loadOwnerBillingView(tenant.id),
    loadUsageBillingExtras(tenant.id),
  ]);
  // tenant_billing_state first (Ops-Billing #650); tenant counters only before it exists.
  const pack = billing ? null : await loadOwnerPackageMeter(tenant.id);
  const minutesIncluded = billing ? billing.minutesIncluded : pack?.minutesIncluded ?? 0;
  const packMinutes = minuteMeter(pack?.minutesIncluded ?? 0, pack?.secondsUsed ?? 0);
  const minutesUsed = billing ? billing.minutesUsed : packMinutes.used;
  const meterMode: MinutesMeterMode = billing
    ? billing.mode
    : isBeta
      ? "beta"
      : tenant.billing_enforcement === "hard"
        ? "capped"
        : tenant.billing_enforcement === "soft"
          ? "metered"
          : "none";
  const minutesLeft = billing ? billing.minutesLeft : packMinutes.left;
  const minutesUnderOne = billing ? billing.minutesUnderOne : packMinutes.underOneMinute;
  const packLabel = billing
    ? billing.shortLabel
    : pack?.packageName
      ? `${pack.packageName}${pack.period ? ` / ${pack.period}` : ""}`
      : "No package";
  const low = billing
    ? lowBalanceNotice(billing, messageCreditsUsage(extras.messageCredits, extras.creditBurns, billing.messageUse))
    : null;
  const lowNotice = low?.lowNotice || null;
  const lowNoticeNote = low?.lowNoticeNote || null;
  const minuteStatus = lowNotice
    ? null
    : homeMinuteStatus({
        isBeta,
        onDemand: Boolean(tenant.on_demand_usage_enabled),
        minutesIncluded,
        minutesLeft,
      });
  return (
    <HomeUsageSection
      minutesLeft={minutesLeft}
      minutesUnderOne={minutesUnderOne}
      packLabel={packLabel}
      minuteStatus={minuteStatus}
      lowNotice={lowNotice}
      lowNoticeNote={lowNoticeNote}
      showLink={Boolean(lowNotice || (minuteStatus && !isBeta))}
      isBeta={isBeta}
      meter={{
        included: minutesIncluded,
        used: minutesUsed,
        left: minutesLeft,
        underOne: minutesUnderOne,
        mode: meterMode,
        overLabel: billing?.minutesOverLabel ?? packMinutes.overLabel,
      }}
    />
  );
}

/** Call setup nudge (finish, reaching, test). Hidden for viewers, as before. */
export async function HomeCallSetupSlot({ tenantId, numberReady }: { tenantId: string; numberReady: boolean }) {
  const callSetup = numberReady ? await loadCallSetupState(tenantId) : null;
  const status = callSetup?.supported
    ? resolveCallSetupStatus({ numberReady, setup: callSetup.setup, activity: callSetup.activity, now: Date.now() })
    : null;
  return (
    <RoleGate action="settings.edit" mode="hide">
      <HomeCallSetupCard
        tenantId={tenantId}
        numberReady={numberReady}
        supported={Boolean(callSetup?.supported)}
        status={status}
      />
    </RoleGate>
  );
}

/** Get ready / data checks card. Area nudge only for members who can edit Settings. */
export async function HomeChecksSlot({ tenant, canEditSettings }: { tenant: HomeTenant; canEditSettings: boolean }) {
  const assistantSayPage = deskAssistantSayPage();
  const [readyChecklist, areaNudge] = await Promise.all([
    assistantSayPage ? loadReadyChecklist(tenant) : Promise.resolve(null),
    canEditSettings ? areaConfirmCheck(tenant) : Promise.resolve(null),
  ]);
  const overviewChecks = dataChecksFor(tenant, {
    saveIsConfirm: factSaveIsConfirm(),
    readyItems: readyChecklist?.items,
  });
  // Brain #942 answers coverage only from confirmed picks: nudge until the owner confirms.
  if (areaNudge) overviewChecks.unshift(areaNudge);
  if (assistantSayPage && readyChecklist && !readyChecklist.allDone) {
    return <HomeGetReadyCallsCard items={readyChecklist.items} checks={overviewChecks} canEdit={canEditSettings} />;
  }
  if (!assistantSayPage && overviewChecks.length) {
    return <OverviewDataChecksCard checks={overviewChecks} canEdit={canEditSettings} />;
  }
  return null;
}

/** What callers told us (last 30 days). */
export async function HomeInsightsSlot({ client, tenant }: { client: HomeClient; tenant: HomeTenant }) {
  const loaded = await loadCallInsights(client, tenant.id, 30, tenant.faqs);
  if (!loaded.ok) return <HomeInsightsError />;
  return <CallInsights insights={loaded.insights} />;
}
