import Link from "next/link";
import { getCurrentTenant, createWorkspaceDataClient } from "@/lib/tenant";
import {
  WALLET_LINE_FEE_KES_PER_MONTH,
  WALLET_RATE_KES_PER_MINUTE,
  getTenantUsageSummary,
} from "@/lib/wallet";

function Kpi({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">{label}</p>
      <p
        className={`mt-2 font-display text-3xl tracking-tight ${
          warn ? "text-[var(--warn)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-[var(--ink-soft)]">{hint}</p> : null}
    </div>
  );
}

function kindLabel(kind: string): string {
  if (kind === "call_charge") return "Call";
  if (kind === "line_rental") return "Line fee";
  if (kind === "admin_adjustment") return "Adjustment";
  if (kind === "topup") return "Top-up";
  if (kind === "trial_credit") return "Trial / beta credit";
  return kind;
}

export default async function WalletPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 text-[var(--ink-soft)]">
        No workspace linked to this account yet.{" "}
        <Link href="/signup" className="text-[var(--accent)]">
          Create one
        </Link>
        .
      </div>
    );
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load usage: {message}
      </div>
    );
  }

  const billedThisMonth = usage.callChargesKes + usage.lineFeeKes;

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Wallet</h1>
          <p className="mt-2 text-[var(--ink-soft)]">
            One prepaid KES balance for line rental and assistant minutes.
          </p>
        </div>
        <span className="rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-deep)]">
          {usage.isBeta ? "Free beta (not charged)" : "Prepaid · KES"}
        </span>
      </div>

      <section className="mt-8 grid gap-3 sm:grid-cols-2">
        <Kpi
          label="Wallet balance"
          value={`KES ${usage.walletBalanceKes.toLocaleString("en-KE")}`}
          hint={
            usage.isBeta
              ? "Beta workspace: usage is tracked, nothing is deducted."
              : usage.lowBalance
                ? "Low balance. Ask Scalers to top up (M-Pesa coming soon)."
                : "Covers line fee + call minutes"
          }
          warn={!usage.isBeta && usage.lowBalance}
        />
        <Kpi
          label={usage.isBeta ? "Would cost this month" : "Billed this month"}
          value={`KES ${(usage.isBeta ? usage.estimatedCostKes : billedThisMonth).toLocaleString("en-KE")}`}
          hint={
            usage.isBeta
              ? `Illustrative at KES ${WALLET_RATE_KES_PER_MINUTE}/min (not charged)`
              : `Calls KES ${usage.callChargesKes.toLocaleString("en-KE")} · Line KES ${usage.lineFeeKes.toLocaleString("en-KE")}`
          }
        />
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">This month</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
          <div>
            <dt className="text-[var(--ink-soft)]">Calls answered</dt>
            <dd className="mt-1 font-display text-2xl">{usage.callsThisMonth}</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-soft)]">Receptionist minutes</dt>
            <dd className="mt-1 font-display text-2xl">{usage.minutesThisMonth}</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-soft)]">Minutes at rate card</dt>
            <dd className="mt-1 font-display text-2xl">
              KES {usage.estimatedCostKes.toLocaleString("en-KE")}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-[var(--ink-soft)] leading-relaxed">
          Rate card: KES {WALLET_RATE_KES_PER_MINUTE}/min (AI included) + KES{" "}
          {WALLET_LINE_FEE_KES_PER_MONTH.toLocaleString("en-KE")}/mo line fee
          {usage.isBeta
            ? ". You are on the beta whitelist (metered only)."
            : ". Soft billing: usage is deducted; calls are not blocked at zero yet."}
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <h2 className="font-display text-2xl tracking-tight">Recent activity</h2>
        {usage.recentLedger.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">
            {usage.isBeta
              ? "No charges while on free beta. Usage still appears above."
              : "No ledger entries yet."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {usage.recentLedger.map((row) => {
              const credit = row.amount_kes > 0;
              return (
                <li key={row.id} className="flex items-baseline justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--ink)]">{kindLabel(row.kind)}</p>
                    <p className="text-xs text-[var(--ink-soft)]">
                      {new Date(row.created_at).toLocaleString("en-KE")}
                      {row.note ? ` · ${row.note}` : ""}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 font-medium ${
                      credit ? "text-[var(--accent-deep)]" : "text-[var(--ink)]"
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
