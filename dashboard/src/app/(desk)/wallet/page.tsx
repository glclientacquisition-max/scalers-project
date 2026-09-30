import { redirect } from "next/navigation";
import { getCurrentTenant, createWorkspaceDataClient } from "@/lib/tenant";
import { getTenantUsageSummary } from "@/lib/wallet";
import {
  inboundKesPerMinute,
  loadOwnerPackageMeter,
  outboundKesPerMinute,
  remainingCount,
} from "@/lib/packageCatalog";
import { usageCapNotice } from "@/lib/usageCap";
import { OnDemandUsagePanel } from "@/components/OnDemandUsagePanel";
import { DeskError } from "@/components/ui/DeskError";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { Pagination } from "@/components/ui/Pagination";
import { deskListTitleClass, deskPreviewCellClass, deskPreviewClass } from "@/components/ui/deskChrome";
import { clampListPage, DEFAULT_PAGE_SIZE } from "@/lib/listPage";

export const instant = false;

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

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
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

  let usage;
  try {
    usage = await getTenantUsageSummary(workspace.client, tenant.id, {
      ledgerPage: page,
      ledgerPageSize: DEFAULT_PAGE_SIZE,
      walletKes: tenant.wallet_balance_kes,
      telecomKes: tenant.telecom_wallet_balance_kes,
      aiUsd: tenant.ai_wallet_balance_usd,
      billingEnforcement: tenant.billing_enforcement,
      softSpendLimitEnabled: tenant.soft_spend_limit_enabled,
      softSpendLimitKes: tenant.soft_spend_limit_kes,
    });
  } catch {
    return <DeskLoadError>Could not load Usage.</DeskLoadError>;
  }

  const pack = await loadOwnerPackageMeter(tenant.id);
  const minutesLeft = remainingCount(pack.minutesIncluded, pack.minutesUsed);
  const smsLeft = remainingCount(pack.smsIncluded, pack.smsUsed);
  const emailLeft = remainingCount(pack.emailIncluded, pack.emailUsed);
  const waLeft = remainingCount(pack.waIncluded, pack.waUsed);
  const inboundMin = inboundKesPerMinute(pack.rates.inboundKesPerSecond);
  const outboundMin = outboundKesPerMinute(pack.rates.outboundKesPerSecond);
  const capNotice = usageCapNotice({
    isBeta: usage.isBeta,
    onDemand: Boolean(tenant.on_demand_usage_enabled),
    minutesIncluded: pack.minutesIncluded,
    minutesLeft,
    smsIncluded: pack.smsIncluded,
    smsLeft,
    emailIncluded: pack.emailIncluded,
    emailLeft,
    waIncluded: pack.waIncluded,
    waLeft,
  });

  const safePage = clampListPage(page, usage.ledgerTotal, DEFAULT_PAGE_SIZE);
  if (safePage !== page) {
    redirect(safePage > 1 ? `/wallet?page=${safePage}` : "/wallet");
  }

  const packLabel = pack.packageName
    ? `${pack.packageName}${pack.period ? ` / ${pack.period}` : ""}`
    : "No package";
  const minuteMax = Math.max(0, pack.minutesIncluded);
  const minuteLeftPct = minuteMax > 0 ? Math.min(100, Math.round((minutesLeft / minuteMax) * 100)) : 0;
  const buckets = [
    { label: "Minutes", left: minutesLeft, used: pack.minutesUsed },
    { label: "SMS", left: smsLeft, used: pack.smsUsed },
    { label: "Email", left: emailLeft, used: pack.emailUsed },
    { label: "WhatsApp", left: waLeft, used: pack.waUsed },
    { label: "Seats", left: remainingCount(pack.seatsIncluded, pack.seatsUsed), used: pack.seatsUsed },
  ];

  return (
    <div className="max-w-3xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className={deskListTitleClass}>Usage</h1>
        <p className="text-sm text-ink-soft">{packLabel}</p>
      </header>

      {usage.isBeta ? <p className="mt-3 text-sm text-ink-soft">Free beta</p> : null}

      {capNotice ? (
        <p className="mt-4 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          {capNotice}
        </p>
      ) : null}

      <section className="mt-6">
        <p className="text-sm text-ink-soft">Minutes left</p>
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
          <p className="mt-2 text-sm text-ink-soft">No package minutes</p>
        )}

        <table className="mt-6 w-full text-left text-sm">
          <caption className="sr-only">Included amounts</caption>
          <thead className="border-b border-line text-ink-soft">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Included</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Left</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Used</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((row) => (
              <tr key={row.label} className="border-b border-line">
                <th scope="row" className="py-3 pr-3 font-normal text-ink">{row.label}</th>
                <td className="px-3 py-3 text-right font-medium tabular-nums text-ink">{count(row.left)}</td>
                <td className="py-3 pl-3 text-right tabular-nums text-ink-soft">{count(row.used)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-6">
        <OnDemandUsagePanel
          tenantId={tenant.id}
          enabled={Boolean(tenant.on_demand_usage_enabled)}
        />
      </div>

      <section className="mt-6">
        <h2 className="font-display text-xl tracking-tight text-ink">On-demand rates</h2>
        <table className="mt-3 w-full text-left text-sm">
          <caption className="sr-only">Prices past the included amounts</caption>
          <tbody>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">Calls in</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(inboundMin)}/min</td>
            </tr>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">Calls out</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(outboundMin)}/min</td>
            </tr>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">SMS</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(pack.rates.smsKes)}</td>
            </tr>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">Email</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(pack.rates.emailKes)}</td>
            </tr>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 pr-3 font-normal text-ink">WhatsApp</th>
              <td className="py-3 text-right tabular-nums text-ink">KES {kes(pack.rates.whatsappKes)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <h2 className="px-4 pt-4 font-display text-xl tracking-tight text-ink">Activity</h2>
        {usage.recentLedger.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-soft">
            {usage.isBeta ? "No charges during beta." : "No ledger entries yet."}
          </p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead className="border-b border-line text-ink-soft">
              <tr>
                <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                  When
                </th>
                <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                  Kind
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-[0.14em]"
                >
                  KES
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.recentLedger.map((row) => {
                const credit = row.amount_kes > 0;
                return (
                  <tr key={row.id} className="border-t border-line/70">
                    <td className="whitespace-nowrap px-4 py-2 text-ink-soft">
                      {new Date(row.created_at).toLocaleString("en-KE")}
                    </td>
                    <td className={`${deskPreviewCellClass} px-4 py-2`}>
                      <p className={deskPreviewClass}>
                        <span className="font-medium text-ink">{kindLabel(row.kind)}</span>
                        {row.note ? <span className="text-ink-soft"> · {row.note}</span> : null}
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
