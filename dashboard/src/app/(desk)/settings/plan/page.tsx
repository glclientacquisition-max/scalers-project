import type { ReactNode } from "react";
import { DeskPageGate } from "@/components/DeskPageGate";
import { PageHeader } from "@/components/ui/PageHeader";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { BillingNote } from "@/components/DeskBillingBanner";
import { PlanPicker } from "@/components/plan/PlanPicker";
import { getCurrentTenant } from "@/lib/tenant";
import { loadOwnerPlan } from "@/lib/ownerPlanLoad";

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div data-desk-nested="" className="mx-auto w-full max-w-lg px-4 py-4">
      <PageHeader title={title} back={{ href: "/settings", label: "Settings" }} />
      {children}
    </div>
  );
}

function FreeBeta({ title }: { title: string }) {
  return (
    <Frame title={title}>
      <h2 className="mt-6 text-title text-ink">Free during beta</h2>
      <p className="mt-1 text-body text-ink-2">Nothing is charged. Your Business Assistant keeps answering.</p>
    </Frame>
  );
}

async function PlanBody({ searchParams }: { searchParams: Promise<{ addon?: string }> }) {
  const addon = (await searchParams).addon || "";
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const loaded = await loadOwnerPlan(tenant.id);
  if (!loaded.ok) return <DeskLoadError>Could not load Plan.</DeskLoadError>;
  if (loaded.model.freeBeta || !loaded.model.surface.showPlanPicker) return <FreeBeta title="Plan" />;
  return (
    <Frame title="Plan">
      {loaded.model.surface.showDunningBanner && loaded.model.banner ? (
        <BillingNote banner={loaded.model.banner} />
      ) : null}
      <PlanPicker model={loaded.model} openSeat={addon === "seat"} />
    </Frame>
  );
}

export default function PlanPage({ searchParams }: { searchParams: Promise<{ addon?: string }> }) {
  return (
    <DeskPageGate>
      <PlanBody searchParams={searchParams} />
    </DeskPageGate>
  );
}
