import { redirect } from "next/navigation";
import { memberCan } from "@/lib/requireMember";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { getCurrentTenant, createWorkspaceDataClient } from "@/lib/tenant";
import { getTenantUsageSummary } from "@/lib/wallet";
import { loadOwnerPackageMeter } from "@/lib/packageCatalog";
import { loadUsageBillingExtras } from "@/lib/ownerPlanLoad";
import { formatKsh } from "@/lib/planPricing";
import { loadOwnerBillingView } from "@/lib/billingStateLoad";
import { ownerBillingView } from "@/lib/billingStateModel";
import { createDeskTimer } from "@/lib/deskTiming";
import { OnDemandUsagePanel } from "@/components/OnDemandUsagePanel";
import { UsageSummary } from "@/components/plan/UsageSummary";
import { DeskError } from "@/components/ui/DeskError";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { Pagination } from "@/components/ui/Pagination";
import { deskPreviewCellClass, deskPreviewClass } from "@/components/ui/deskChrome";
import { clampListPage, DEFAULT_PAGE_SIZE } from "@/lib/listPage";

import { DeskPageGate } from "@/components/DeskPageGate";

function kindLabel(kind: string): string {
  if (kind === "call_charge") return "Call";
  if (kind === "sms_charge") return "Message";
  if (kind === "line_rental") return "Line fee";
  if (kind === "admin_adjustment") return "Adjustment";
  if (kind === "topup") return "Top-up";
  if (kind === "trial_credit") return "Trial credit";
  return kind;
}

type WalletPageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default function WalletPage(props: WalletPageProps) {
  return (
    <DeskPageGate>
      <WalletBody {...props} />
    </DeskPageGate>
  );
}

async function WalletBody({ searchParams }: WalletPageProps) {
  if (!(await memberCan("usage.view"))) return <DeskNoAccess what="Usage" />;
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const timer = createDeskTimer();
  let usage;
  let billing;
  let pack;
  let extras;
  let canChangePlan = false;
  try {
    [usage, billing, pack, extras, canChangePlan] = await Promise.all([
      getTenantUsageSummary(workspace.client, tenant.id, {
        ledgerPage: page,
        ledgerPageSize: DEFAULT_PAGE_SIZE,
        billingEnforcement: tenant.billing_enforcement,
        softSpendLimitEnabled: tenant.soft_spend_limit_enabled,
        softSpendLimitKes: tenant.soft_spend_limit_kes,
        // The Usage page reads minutes from tenant_billing_state, not from call rows.
        skipCallRows: true,
      }),
      loadOwnerBillingView(tenant.id),
      loadOwnerPackageMeter(tenant.id),
      loadUsageBillingExtras(tenant.id),
      memberCan("billing.manage"),
    ]);
  } catch {
    return <DeskLoadError>Could not load Usage.</DeskLoadError>;
  }
  timer.mark("data");
  console.info(timer.line("usage"));

  // Before tenant_billing_state exists: same wording from the tenant counters.
  const view =
    billing ||
    ownerBillingView({
      state: pack.packageName
        ? {
            package_state: "active",
            package_name: pack.packageName,
            included_minutes: pack.minutesIncluded,
            used_minutes: pack.minutesUsed,
            sms_included: pack.smsIncluded,
            sms_used: pack.smsUsed,
            on_demand_enabled: Boolean(tenant.on_demand_usage_enabled),
            mode_label: usage.isBeta ? "beta" : tenant.on_demand_usage_enabled ? "metered" : "capped",
          }
        : null,
      monthlyPriceKes: null,
      smsMessages: null,
      seatsIncluded: pack.seatsIncluded,
      seatsUsed: pack.seatsUsed,
      alerts: {
        email: { included: pack.emailIncluded, used: pack.emailUsed },
        whatsapp: { included: pack.waIncluded, used: pack.waUsed },
      },
    });

  const safePage = clampListPage(page, usage.ledgerTotal, DEFAULT_PAGE_SIZE);
  if (safePage !== page) {
    redirect(safePage > 1 ? `/wallet?page=${safePage}` : "/wallet");
  }

  const creditIncluded = extras.messageCredits;
  const usageRows = (
    creditIncluded == null
      ? view.rows
      : view.rows
          .filter((row) => row.key !== "email" && row.key !== "whatsapp")
          .map((row) =>
            row.key === "sms"
              ? {
                  ...row,
                  label: "Message credits",
                  included: creditIncluded,
                  left: Math.max(0, creditIncluded - row.used),
                  note: null,
                }
              : row,
          )
  ).filter((row) => row.key !== "minutes");
  const planLine =
    extras.freeBeta || extras.monthlyPriceKes == null
      ? null
      : `${view.packageName ? `${view.packageName} · ` : ""}${formatKsh(extras.monthlyPriceKes)} a month`;

  return (
    <div>
      <UsageSummary
        minutesLeft={view.minutesLeft}
        minutesIncluded={view.minutesIncluded}
        minutesUsed={Math.max(0, view.minutesIncluded - view.minutesLeft)}
        periodEndLabel={view.periodEndLabel}
        beta={extras.freeBeta}
        planLine={planLine}
        rows={usageRows}
        showChangePlan={canChangePlan}
      />
      {extras.freeBeta || extras.onDemandLocked ? null : (
        <div className="max-w-2xl">
          <OnDemandUsagePanel
            tenantId={tenant.id}
            enabled={Boolean(tenant.on_demand_usage_enabled)}
            extraMinuteKes={extras.inboundPerMinuteKes}
          />
        </div>
      )}

      <section className="mt-6 max-w-2xl overflow-hidden rounded-2xl border border-hairline bg-surface">
        <h2 className="px-4 pt-4 font-display text-title tracking-tight text-ink">Activity</h2>
        {usage.recentLedger.length === 0 ? (
          <p className="px-4 py-3 text-body text-ink-2">
            {usage.isBeta ? "Nothing charged during beta." : "No charges yet."}
          </p>
        ) : (
          <table className="mt-2 w-full text-left text-body">
            <thead className="border-b border-hairline text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2 text-meta font-semibold">
                  When
                </th>
                <th scope="col" className="px-4 py-2 text-meta font-semibold">
                  Kind
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-right text-meta font-semibold"
                >
                  KSh
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.recentLedger.map((row) => {
                const credit = row.amount_kes > 0;
                return (
                  <tr key={row.id} className="border-t border-hairline/70">
                    <td className="whitespace-nowrap px-4 py-2 text-ink-2">
                      {new Date(row.created_at).toLocaleString("en-KE")}
                    </td>
                    <td className={`${deskPreviewCellClass} px-4 py-2`}>
                      <p className={deskPreviewClass}>
                        <span className="font-medium text-ink">{kindLabel(row.kind)}</span>
                        {row.note ? <span className="text-ink-2"> · {row.note}</span> : null}
                      </p>
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-medium tabular-nums ${
                        credit ? "text-accent-deep" : "text-ink"
                      }`}
                    >
                      {credit ? "+" : ""}
                      {row.amount_kes.toLocaleString("en-KE")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {usage.ledgerTotal > 0 ? (
          <div className="px-4 pb-4">
            <Pagination
              page={safePage}
              pageSize={DEFAULT_PAGE_SIZE}
              total={usage.ledgerTotal}
              href="/wallet"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
