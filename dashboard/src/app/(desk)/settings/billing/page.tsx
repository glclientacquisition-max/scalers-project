import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { BillingNote } from "@/components/DeskBillingBanner";
import { BillingHistory } from "@/components/plan/BillingHistory";
import { NoticeList } from "@/components/plan/NoticeList";
import { SettingsPlanFrame } from "@/components/plan/SettingsPlanFrame";
import { memberCan } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import { loadOwnerPlan } from "@/lib/ownerPlanLoad";

async function BillingBody({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  if (!(await memberCan("billing.manage"))) return <DeskNoAccess what="Billing" />;
  const fromPay = (await searchParams).from === "pay";
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const loaded = await loadOwnerPlan(tenant.id);
  if (!loaded.ok) return <DeskLoadError>Could not load Billing.</DeskLoadError>;
  const model = loaded.model;
  if (model.freeBeta || !model.surface.showInvoices) {
    return (
      <SettingsPlanFrame title="Billing">
        <h2 className="mt-6 text-title text-ink">Free during beta</h2>
        <p className="mt-1 text-body text-ink-2">Nothing is charged. Your Business Assistant keeps answering.</p>
      </SettingsPlanFrame>
    );
  }

  return (
    <SettingsPlanFrame title="Billing">
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
