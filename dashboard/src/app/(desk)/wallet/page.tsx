import Link from "next/link";
import { getCurrentTenant, createWorkspaceDataClient } from "@/lib/tenant";
import {
  WALLET_LINE_FEE_KES_PER_MONTH,
  WALLET_LOW_BALANCE_KES,
  WALLET_RATE_KES_PER_MINUTE,
  getTenantUsageSummary,
} from "@/lib/wallet";

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
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-ink-soft">
        No workspace linked to this account yet.{" "}
        <Link href="/signup" className="text-[#0096FF]">
          Create one
        </Link>
        .
      </div>
    );
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Not signed in.
      </div>
    );
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Could not load usage: {message}
      </div>
    );
  }

  const billedThisMonth = usage.callChargesKes + usage.lineFeeKes;
  const lowThreshold = Number(tenant.wallet_low_balance_kes ?? WALLET_LOW_BALANCE_KES);
  const prepaidEmpty = !usage.isBeta && usage.walletBalanceKes <= 0;
  const prepaidLow =
    !usage.isBeta && usage.walletBalanceKes > 0 && usage.walletBalanceKes < lowThreshold;

  return (
    <div className="max-w-3xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">Wallet</h1>
        {usage.isBeta ? (
          <span className="inline-flex min-h-[3.25rem] items-center rounded-xl border border-[#0096FF]/30 bg-[#0096FF]/5 px-6 py-3 text-sm font-medium text-[#005ccc]">
            Free beta
          </span>
        ) : null}
      </header>

      {(prepaidEmpty || prepaidLow) && !usage.isBeta ? (
        <p className="mt-4 rounded-xl border border-warn/40 bg-white px-4 py-3 text-sm text-warn">
          {prepaidEmpty ? "Prepaid empty." : `Prepaid under KES ${lowThreshold.toLocaleString("en-KE")}.`}
        </p>
      ) : null}

      <section className="mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              {usage.isBeta ? "Usage this month" : "Balance"}
            </p>
            <p
              className={[
                "mt-2 font-display text-5xl tracking-tight sm:text-[3.25rem]",
                usage.isBeta || !usage.lowBalance ? "text-ink" : "text-warn",
              ].join(" ")}
            >
              {usage.isBeta
                ? `KES ${usage.estimatedCostKes.toLocaleString("en-KE")}`
                : `KES ${usage.walletBalanceKes.toLocaleString("en-KE")}`}
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              {usage.isBeta
                ? "Metered automatically. No charges during beta."
                : "Prepaid KES"}
            </p>
          </div>
          <dl className="grid min-w-[12rem] gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Calls</dt>
              <dd className="mt-1 font-display text-2xl text-ink">{usage.callsThisMonth}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Minutes</dt>
              <dd className="mt-1 font-display text-2xl text-ink">{usage.minutesThisMonth}</dd>
            </div>
            {!usage.isBeta ? (
              <>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-soft">Billed month</dt>
                  <dd className="mt-1 font-display text-2xl text-ink">
                    KES {billedThisMonth.toLocaleString("en-KE")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-soft">Line fee</dt>
                  <dd className="mt-1 font-display text-2xl text-ink">
                    KES {usage.lineFeeKes.toLocaleString("en-KE")}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-soft">Call rate</dt>
                  <dd className="mt-1 font-display text-2xl text-ink">
                    KES {WALLET_RATE_KES_PER_MINUTE}/min
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-soft">Line fee</dt>
                  <dd className="mt-1 font-display text-2xl text-ink">
                    KES {WALLET_LINE_FEE_KES_PER_MONTH.toLocaleString("en-KE")}/mo
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>

        <dl className="mt-8 grid gap-3 border-t border-line pt-6 sm:grid-cols-3 text-sm">
          {usage.isBeta ? (
            <>
              <div>
                <dt className="text-ink-soft">Call charges</dt>
                <dd className="mt-1 font-medium text-ink">
                  KES {usage.callChargesKes.toLocaleString("en-KE")}
                </dd>
              </div>
              <div>
                <dt className="text-ink-soft">Line fee (est.)</dt>
                <dd className="mt-1 font-medium text-ink">
                  KES {usage.lineFeeKes.toLocaleString("en-KE")}
                </dd>
              </div>
              <div>
                <dt className="text-ink-soft">Billing</dt>
                <dd className="mt-1 font-medium text-ink">Automatic metering</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt className="text-ink-soft">Call rate</dt>
                <dd className="mt-1 font-medium text-ink">
                  KES {WALLET_RATE_KES_PER_MINUTE}/min
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
            </>
          )}
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-display text-xl tracking-tight text-ink">Recent activity</h2>
        {usage.recentLedger.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            {usage.isBeta ? "No charges during beta." : "No ledger entries yet."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {usage.recentLedger.map((row) => {
              const credit = row.amount_kes > 0;
              return (
                <li key={row.id} className="flex items-baseline justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{kindLabel(row.kind)}</p>
                    <p className="text-xs text-ink-soft">
                      {new Date(row.created_at).toLocaleString("en-KE")}
                      {row.note ? ` · ${row.note}` : ""}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 font-medium ${
                      credit ? "text-[#005ccc]" : "text-ink"
                    }`}
                  >
                    {credit ? "+" : ""}
                    {row.amount_kes.toLocaleString("en-KE")} KES
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
