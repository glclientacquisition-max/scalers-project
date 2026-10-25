import { DeskPageGate } from "@/components/DeskPageGate";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { PoliciesScreen } from "@/components/policies/PoliciesScreen";
import { nicheFor, type Rule } from "@/lib/policyRegistry";
import { memberCan } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";

async function PoliciesBody({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  if (!(await memberCan("settings.edit"))) return <DeskNoAccess what="Policies" />;
  const tenant = await getCurrentTenant();
  if (!tenant) return <DeskNoWorkspace />;
  const bp = (tenant.business_policies as Record<string, unknown> | null) ?? {};
  const rules = (bp.rules && typeof bp.rules === "object" ? bp.rules : {}) as Record<string, Rule>;
  const payment = String(bp.payment ?? "").trim() || null;
  const niche = nicheFor(tenant as { vertical?: string | null; business_name?: string | null });
  return (
    <div className="mx-auto w-full min-w-0 md:max-w-2xl" data-desk-nested="">
      <PoliciesScreen
        nicheId={niche.id}
        rules={rules}
        payment={{ line: payment, href: "/settings?tab=train&panel=policies" }}
        initialTopic={(await searchParams).topic ?? null}
      />
    </div>
  );
}

export default function PoliciesPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  return (
    <DeskPageGate>
      <PoliciesBody searchParams={searchParams} />
    </DeskPageGate>
  );
}
