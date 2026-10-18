import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { BillingNote } from "@/components/DeskBillingBanner";
import { BetaInvoicesEmpty } from "@/components/plan/BetaPlanSummary";
import { BillingHistory } from "@/components/plan/BillingHistory";
import { NoticeList } from "@/components/plan/NoticeList";
import { SettingsPlanFrame } from "@/components/plan/SettingsPlanFrame";
import { memberCan } from "@/lib/requireMember";
import { loadSettingsStatuses } from "@/lib/settingsRailStatus";
import { getCurrentTenant } from "@/lib/tenant";
import { loadOwnerPlan } from "@/lib/ownerPlanLoad";

async function BillingBody({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  if (!(await memberCan("billing.manage"))) return <DeskNoAccess what="Billing" />;
  const fromPay = (await searchParams).from === "pay";
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const [loaded, statuses] = await Promise.all([loadOwnerPlan(tenant.id), loadSettingsStatuses(tenant)]);
  if (!loaded.ok) return <DeskLoadError>Could not load Billing.</DeskLoadError>;
  const model = loaded.model;
  if (model.freeBeta || !model.surface.showInvoices) {
    return (
      <SettingsPlanFrame title="Billing" optionStatus={statuses}>
        <BetaInvoicesEmpty />
      </SettingsPlanFrame>
    );
  }

  return (
    <SettingsPlanFrame title="Billing" optionStatus={statuses}>
      {model.surface.showDunningBanner && model.banner ? <BillingNote banner={model.banner} /> : null}
      <BillingHistory fromPay={fromPay && model.surface.showPayLinks} />
      <NoticeList notices={model.notices} />
    </SettingsPlanFrame>
  );
}

export default function BillingPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  return (
    <DeskPageGate>
      <BillingBody searchParams={searchParams} />
    </DeskPageGate>
  );
}
