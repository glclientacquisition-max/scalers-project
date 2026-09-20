import { getCurrentTenant, createWorkspaceDataClient } from "@/lib/tenant";
import {
  WALLET_LINE_FEE_KES_PER_MONTH,
  WALLET_LOW_BALANCE_KES,
  WALLET_RATE_KES_PER_MINUTE,
  WALLET_TRANSFER_RATE_KES_PER_MINUTE,
  getTenantUsageSummary,
} from "@/lib/wallet";
import { OnDemandUsagePanel } from "@/components/OnDemandUsagePanel";
import { WalletTopUpButton } from "@/components/WalletTopUpButton";
import { getWalletTopUpConfig } from "@/lib/walletTopUp";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { deskListTitleClass, deskPreviewCellClass, deskPreviewClass } from "@/components/ui/deskChrome";

function kindLabel(kind: string): string {
  if (kind === "call_charge") return "Call";
  if (kind === "line_rental") return "Line fee";
  if (kind === "admin_adjustment") return "Adjustment";
  if (kind === "topup") return "Top-up";
  if (kind === "trial_credit") return "Trial credit";
  return kind;
}

export default async function WalletPage() {
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

  const billedThisMonth = usage.callChargesKes + usage.lineFeeKes;
  const lowThreshold = Number(tenant.wallet_low_balance_kes ?? WALLET_LOW_BALANCE_KES);
  const prepaidEmpty = !usage.isBeta && usage.walletBalanceKes <= 0;
  const prepaidLow =
    !usage.isBeta && usage.walletBalanceKes > 0 && usage.walletBalanceKes < lowThreshold;
  const topUpConfig = getWalletTopUpConfig();
  const smsIncluded = Number(tenant.sms_included_units);
  const smsUsed = Math.max(0, Number(tenant.sms_used_units ?? 0));
  const hasSmsMeter = Number.isFinite(smsIncluded);
  const smsExhausted =
    !usage.isBeta &&
    hasSmsMeter &&
    smsUsed >= smsIncluded &&
    !tenant.on_demand_usage_enabled;

  return (
    <div className="max-w-3xl">
      <header className="space-y-3">
        <h1 className={deskListTitleClass}>Usage</h1>
        <div className="flex flex-wrap items-start justify-end gap-4">
          {usage.isBeta ? (
            <span className="inline-flex min-h-[3.25rem] items-center rounded-xl border border-accent/30 bg-accent/5 px-6 py-3 text-sm font-medium text-accent-deep">
              Free beta
            </span>
          ) : (
            <WalletTopUpButton
              tenantId={tenant.id}
              topUpEnabled={topUpConfig.enabled}
              presets={topUpConfig.presets}
            />
          )}
        </div>
      </header>

      {(prepaidEmpty || prepaidLow || smsExhausted) && !usage.isBeta ? (
        <div className="mt-4 space-y-3">
          {prepaidEmpty || prepaidLow ? (
            <p className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
              {prepaidEmpty
                ? tenant.on_demand_usage_enabled
                  ? "Prepaid empty. On-demand is on."
                  : "Prepaid empty. Top up or enable on-demand below."
                : `Prepaid under KES ${lowThreshold.toLocaleString("en-KE")}.`}
            </p>
          ) : null}
          {smsExhausted ? (
            <p className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
              Included SMS used. Enable on-demand or wait for the next pack.
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Prepaid balance
            </p>
            <p
              className={[
                "mt-2 font-display text-3xl tracking-tight sm:text-4xl",
                !usage.isBeta && usage.lowBalance ? "text-warn" : "text-ink",
              ].join(" ")}
            >
              KES {usage.walletBalanceKes.toLocaleString("en-KE")}
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              {usage.isBeta ? "Metered. No charges during beta." : "Line fee and call minutes"}
            </p>
          </div>
          <dl className="grid min-w-[12rem] gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">
                {usage.isBeta ? "Est. month" : "Billed month"}
              </dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                KES{" "}
                {(usage.isBeta ? usage.estimatedCostKes : billedThisMonth).toLocaleString(
                  "en-KE"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Calls</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">{usage.callsThisMonth}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Minutes</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">{usage.minutesThisMonth}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Line fee</dt>
              <dd className="mt-1 text-lg font-semibold text-ink">
                KES {usage.lineFeeKes.toLocaleString("en-KE")}
              </dd>
            </div>
            {hasSmsMeter ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-soft">SMS</dt>
                <dd className="mt-1 text-lg font-semibold text-ink">
                  {smsUsed.toLocaleString("en-KE")} / {smsIncluded.toLocaleString("en-KE")}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <dl className="mt-8 grid gap-3 border-t border-line pt-6 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-ink-soft">Inbound</dt>
            <dd className="mt-1 font-medium text-ink">
              KES {WALLET_RATE_KES_PER_MINUTE}/min
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Live transfer</dt>
            <dd className="mt-1 font-medium text-ink">
              KES {WALLET_TRANSFER_RATE_KES_PER_MINUTE}/min
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Line rental</dt>
            <dd className="mt-1 font-medium text-ink">
              KES {WALLET_LINE_FEE_KES_PER_MONTH.toLocaleString("en-KE")}/mo
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Call charges</dt>
            <dd className="mt-1 font-medium text-ink">
              KES {usage.callChargesKes.toLocaleString("en-KE")}
            </dd>
          </div>
        </dl>
      </section>

      <div className="mt-6">
        <OnDemandUsagePanel
          tenantId={tenant.id}
          enabled={Boolean(tenant.on_demand_usage_enabled)}
          isBeta={usage.isBeta}
          walletBalanceKes={usage.walletBalanceKes}
          lowThresholdKes={lowThreshold}
        />
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <h2 className="px-4 pt-4 font-display text-xl tracking-tight text-ink">Recent activity</h2>
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
      </section>
    </div>
  );
}
