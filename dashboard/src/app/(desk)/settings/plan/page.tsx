import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { BillingNote } from "@/components/DeskBillingBanner";
import { PlanPicker } from "@/components/plan/PlanPicker";
import { SettingsPlanFrame } from "@/components/plan/SettingsPlanFrame";
import { memberCan } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import { loadOwnerPlan } from "@/lib/ownerPlanLoad";

function FreeBeta() {
  return (
    <SettingsPlanFrame title="Plan">
      <h2 className="mt-6 text-title text-ink">Free during beta</h2>
      <p className="mt-1 text-body text-ink-2">Nothing is charged. Your Business Assistant keeps answering.</p>
    </SettingsPlanFrame>
  );
}

async function PlanBody({ searchParams }: { searchParams: Promise<{ addon?: string }> }) {
  if (!(await memberCan("billing.manage"))) return <DeskNoAccess what="Plan" />;
  const addon = (await searchParams).addon || "";
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const loaded = await loadOwnerPlan(tenant.id);
  if (!loaded.ok) return <DeskLoadError>Could not load Plan.</DeskLoadError>;
  if (loaded.model.freeBeta || !loaded.model.surface.showPlanPicker) return <FreeBeta />;
  return (
    <SettingsPlanFrame title="Plan" meta={loaded.model.trialText}>
      {loaded.model.surface.showDunningBanner && loaded.model.banner ? (
        <BillingNote banner={loaded.model.banner} />
      ) : null}
      <PlanPicker model={loaded.model} openSeat={addon === "seat"} />
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
