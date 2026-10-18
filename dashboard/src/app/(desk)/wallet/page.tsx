import { redirect } from "next/navigation";
import { memberCan } from "@/lib/requireMember";
import { DeskNoAccess } from "@/components/ui/DeskNoAccess";
import { getCurrentTenant, createWorkspaceDataClient } from "@/lib/tenant";
import { getTenantUsageSummary } from "@/lib/wallet";
import { inboundKesPerMinute, loadOwnerPackageMeter } from "@/lib/packageCatalog";
import { loadOwnerBillingView } from "@/lib/billingStateLoad";
import { ownerBillingView } from "@/lib/billingStateModel";
import { createDeskTimer } from "@/lib/deskTiming";
import { OnDemandUsagePanel } from "@/components/OnDemandUsagePanel";
import { DeskError } from "@/components/ui/DeskError";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { Pagination } from "@/components/ui/Pagination";
import { deskListTitleClass, deskPreviewCellClass, deskPreviewClass } from "@/components/ui/deskChrome";
import { clampListPage, DEFAULT_PAGE_SIZE } from "@/lib/listPage";

import { DeskPageGate } from "@/components/DeskPageGate";

function kindLabel(kind: string): string {
  if (kind === "call_charge") return "Call";
  if (kind === "sms_charge") return "SMS";
  if (kind === "line_rental") return "Line fee";
  if (kind === "admin_adjustment") return "Adjustment";
  if (kind === "topup") return "Top-up";
  if (kind === "trial_credit") return "Trial credit";
  return kind;
}

function count(n: number): string {
  return n.toLocaleString("en-KE");
}

function kes(n: number): string {
  return n.toLocaleString("en-KE", { maximumFractionDigits: 2 });
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
  try {
    [usage, billing, pack] = await Promise.all([
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

  const inboundMin = inboundKesPerMinute(pack.rates.inboundKesPerSecond);
  const minutesLeft = view.minutesLeft;
  const minuteMax = Math.max(0, view.minutesIncluded);
  const minuteLeftPct = minuteMax > 0 ? Math.min(100, Math.round((minutesLeft / minuteMax) * 100)) : 0;

  return (
    <div className="max-w-3xl">
      <header>
        <h1 className={deskListTitleClass}>Usage</h1>
        <p className="mt-2 text-body text-ink-2">{view.headline}</p>
      </header>

      {view.lowNotice ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-body text-warn"
        >
          {view.lowNotice}
        </p>
      ) : null}

      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-5">
        <p className="text-body text-ink-2">
          Minutes left{view.periodEndLabel ? ` until ${view.periodEndLabel}` : ""}
        </p>
        <p className="mt-1 font-display text-display tabular-nums text-ink">
          {count(minutesLeft)}
        </p>
        {minuteMax > 0 ? (
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
            role="meter"
            aria-label="Minutes left"
            aria-valuemin={0}
            aria-valuemax={minuteMax}
            aria-valuenow={minutesLeft}
          >
            <div className="h-full bg-accent" style={{ width: `${minuteLeftPct}%` }} />
          </div>
        ) : (
          <p className="mt-2 text-body text-ink-2">No package minutes</p>
        )}

        <table className="mt-6 w-full text-left text-body">
          <caption className="sr-only">What your package includes this month</caption>
          <thead className="border-b border-hairline text-ink-2">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">This month</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Included</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Used</th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">Left</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.key} className="border-b border-hairline">
                <th scope="row" className="py-3 pr-3 font-normal text-ink">
                  {row.label}
                  {row.note ? <span className="block text-meta text-ink-2">{row.note}</span> : null}
                </th>
                <td className="px-2 py-3 text-right tabular-nums text-ink-2">{count(row.included)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-ink-2">{count(row.used)}</td>
                <td className="py-3 pl-2 text-right font-medium tabular-nums text-ink">{count(row.left)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-6">
        <OnDemandUsagePanel
          tenantId={tenant.id}
          enabled={Boolean(tenant.on_demand_usage_enabled)}
          hint={view.onDemandHint}
        />
      </div>

      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="font-display text-title tracking-tight text-ink">{view.ratesTitle}</h2>
        <table className="mt-3 w-full text-left text-body">
          <caption className="sr-only">{view.ratesTitle}</caption>
          <tbody>
            <tr className="border-b border-hairline">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">Calls</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(inboundMin)} a minute</td>
            </tr>
            <tr className="border-b border-hairline">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">SMS</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(pack.rates.smsKes)} a credit</td>
            </tr>
            <tr className="border-b border-hairline">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">Email</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(pack.rates.emailKes)}</td>
            </tr>
            <tr className="border-b border-hairline">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">WhatsApp</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(pack.rates.whatsappKes)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-hairline bg-surface">
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
                  KES
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
