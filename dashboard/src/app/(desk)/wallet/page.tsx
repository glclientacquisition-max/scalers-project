import { redirect } from "next/navigation";
import { getCurrentTenant, createWorkspaceDataClient } from "@/lib/tenant";
import { getTenantUsageSummary } from "@/lib/wallet";
import {
  inboundKesPerMinute,
  loadOwnerPackageMeter,
  outboundKesPerMinute,
  remainingCount,
} from "@/lib/packageCatalog";
import { OnDemandUsagePanel } from "@/components/OnDemandUsagePanel";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { Pagination } from "@/components/ui/Pagination";
import { deskListTitleClass, deskPreviewCellClass, deskPreviewClass } from "@/components/ui/deskChrome";
import { clampListPage, DEFAULT_PAGE_SIZE } from "@/lib/listPage";

export const instant = false;

function kindLabel(kind: string): string {
  if (kind === "call_charge") return "Call";
  if (kind === "line_rental") return "Line fee";
  if (kind === "admin_adjustment") return "Adjustment";
  if (kind === "topup") return "Top-up";
  if (kind === "trial_credit") return "Trial credit";
  return kind;
}

function bucketLabel(used: number, included: number): string {
  return `${used.toLocaleString("en-KE")} / ${included.toLocaleString("en-KE")}`;
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
    return <DeskError>Could not load Usage.</DeskError>;
  }

  const pack = await loadOwnerPackageMeter(tenant.id);
  const minutesLeft = remainingCount(pack.minutesIncluded, pack.minutesUsed);
  const smsLeft = remainingCount(pack.smsIncluded, pack.smsUsed);
  const emailLeft = remainingCount(pack.emailIncluded, pack.emailUsed);
  const waLeft = remainingCount(pack.waIncluded, pack.waUsed);
  const seatsLeft = remainingCount(pack.seatsIncluded, pack.seatsUsed);
  const inboundMin = inboundKesPerMinute(pack.rates.inboundKesPerSecond);
  const outboundMin = outboundKesPerMinute(pack.rates.outboundKesPerSecond);
  const exhausted =
    (pack.minutesIncluded > 0 && minutesLeft <= 0) ||
    (pack.smsIncluded > 0 && smsLeft <= 0) ||
    (pack.emailIncluded > 0 && emailLeft <= 0) ||
    (pack.waIncluded > 0 && waLeft <= 0);

  const safePage = clampListPage(page, usage.ledgerTotal, DEFAULT_PAGE_SIZE);
  if (safePage !== page) {
    redirect(safePage > 1 ? `/wallet?page=${safePage}` : "/wallet");
  }

  const packLabel = pack.packageName
    ? `${pack.packageName}${pack.period ? ` / ${pack.period}` : ""}`
    : "No package";

  return (
    <div className="max-w-3xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <h1 className={deskListTitleClass}>Usage</h1>
        {usage.isBeta ? (
          <span className="inline-flex min-h-12 items-center rounded-xl border border-accent/30 bg-accent/5 px-6 py-3 text-sm font-medium text-accent-deep">
            Free beta
          </span>
        ) : null}
      </header>

      {exhausted && !tenant.on_demand_usage_enabled && !usage.isBeta ? (
        <p className="mt-4 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          Included units used. Enable on-demand or switch package.
        </p>
      ) : null}

      <section className="mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Minutes left</p>
            <p className="mt-2 font-display text-3xl tracking-tight text-ink sm:text-4xl">
              {minutesLeft.toLocaleString("en-KE")}
            </p>
            <p className="mt-2 text-sm text-ink-soft">{packLabel}</p>
          </div>
          <dl className="grid min-w-[12rem] gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Minutes</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                {bucketLabel(pack.minutesUsed, pack.minutesIncluded)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">SMS</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                {bucketLabel(pack.smsUsed, pack.smsIncluded)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Email</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                {bucketLabel(pack.emailUsed, pack.emailIncluded)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">WhatsApp</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                {bucketLabel(pack.waUsed, pack.waIncluded)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Seats</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                {bucketLabel(pack.seatsUsed, pack.seatsIncluded)}
              </dd>
            </div>
          </dl>
        </div>

        <dl className="mt-8 grid gap-3 border-t border-line pt-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-ink-soft">Inbound</dt>
            <dd className="mt-1 font-medium text-ink">KES {inboundMin}/min</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Outbound</dt>
            <dd className="mt-1 font-medium text-ink">KES {outboundMin}/min</dd>
          </div>
          <div>
            <dt className="text-ink-soft">WhatsApp</dt>
            <dd className="mt-1 font-medium text-ink">KES {pack.rates.whatsappKes}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">SMS / email</dt>
            <dd className="mt-1 font-medium text-ink">
              KES {pack.rates.smsKes} / {pack.rates.emailKes}
            </dd>
          </div>
        </dl>
      </section>

      <div className="mt-6">
        <OnDemandUsagePanel
          tenantId={tenant.id}
          enabled={Boolean(tenant.on_demand_usage_enabled)}
        />
      </div>

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
