import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { BillingNote } from "@/components/DeskBillingBanner";
import { BetaPlanSummary, betaPlanRows } from "@/components/plan/BetaPlanSummary";
import { PlanPicker } from "@/components/plan/PlanPicker";
import { SettingsPlanFrame } from "@/components/plan/SettingsPlanFrame";
import { loadOwnerUsageView } from "@/lib/ownerUsageLoad";
import { memberCan } from "@/lib/requireMember";
import { loadSettingsStatuses } from "@/lib/settingsRailStatus";
import { getCurrentTenant } from "@/lib/tenant";
import { loadOwnerPlan, loadUsageBillingExtras } from "@/lib/ownerPlanLoad";
import { deskPlanChangeEnabled } from "@/lib/deskPlanChange";
import { messageCreditsUsage } from "@/lib/messageCredits";

async function PlanBody({ searchParams }: { searchParams: Promise<{ addon?: string }> }) {
  if (!(await memberCan("billing.manage"))) return <DeskNoAccess what="Plan" />;
  const addon = (await searchParams).addon || "";
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const [loaded, statuses] = await Promise.all([loadOwnerPlan(tenant.id), loadSettingsStatuses(tenant)]);
  if (!loaded.ok) return <DeskLoadError>Could not load Plan.</DeskLoadError>;
  if (loaded.model.freeBeta || !loaded.model.surface.showPlanPicker) {
    const [view, extras] = await Promise.all([loadOwnerUsageView(tenant), loadUsageBillingExtras(tenant.id)]);
    const credits = messageCreditsUsage(extras.messageCredits, extras.creditBurns, view.messageUse);
    return (
      <SettingsPlanFrame title="Plan" optionStatus={statuses} hideBilling={loaded.model.freeBeta || !loaded.model.surface.showInvoices}>
        <BetaPlanSummary
          planName={view.packageName}
          periodEndLabel={view.periodEndLabel}
          resetLabel={view.nextResetLabel}
          rows={betaPlanRows(view, credits)}
          freeBeta={loaded.model.freeBeta}
          onDemandEnabled={tenant.on_demand_usage_enabled}
          onDemandLocked={loaded.model.onDemandLocked}
        />
      </SettingsPlanFrame>
    );
  }
  return (
    <SettingsPlanFrame title="Plan" meta={loaded.model.trialText} optionStatus={statuses}>
      {loaded.model.surface.showDunningBanner && loaded.model.banner ? (
        <BillingNote banner={loaded.model.banner} />
      ) : null}
      <PlanPicker
        model={loaded.model}
        openSeat={addon === "seat"}
        planChangesEnabled={deskPlanChangeEnabled()}
        onDemandEnabled={Boolean(tenant.on_demand_usage_enabled)}
      />
    </SettingsPlanFrame>
  );
}

export default function PlanPage({ searchParams }: { searchParams: Promise<{ addon?: string }> }) {
  return (
    <DeskPageGate>
      <PlanBody searchParams={searchParams} />
    </DeskPageGate>
  );
}
