import Link from "next/link";
import { getCurrentTenant, createWorkspaceDataClient } from "@/lib/tenant";
import {
  BETA_LINE_FEE_KES_PER_MONTH,
  BETA_RATE_KES_PER_MINUTE,
  getTenantUsageSummary,
} from "@/lib/wallet";

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">{label}</p>
      <p className="mt-2 font-display text-3xl tracking-tight text-[var(--ink)]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--ink-soft)]">{hint}</p> : null}
    </div>
  );
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
      telecomKes: tenant.telecom_wallet_balance_kes,
      aiUsd: tenant.ai_wallet_balance_usd,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load usage: {message}
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Wallet</h1>
          <p className="mt-2 text-[var(--ink-soft)]">
            Prepaid balances and this month&apos;s receptionist usage.
          </p>
        </div>
        <span className="rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[var(--accent-deep)]">
          Free beta — no charges yet
        </span>
      </div>

      <section className="mt-8 grid gap-3 sm:grid-cols-2">
        <Kpi
          label="Telecom wallet"
          value={`KES ${usage.telecomBalanceKes.toLocaleString("en-KE")}`}
          hint="Line rental & call minutes (when billing starts)"
        />
        <Kpi
          label="AI wallet"
          value={`$${usage.aiBalanceUsd.toFixed(2)}`}
          hint="Receptionist brain usage (when billing starts)"
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
            <dt className="text-[var(--ink-soft)]">Would cost at beta rates</dt>
            <dd className="mt-1 font-display text-2xl">
              KES {usage.estimatedCostKes.toLocaleString("en-KE")}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-[var(--ink-soft)] leading-relaxed">
          Illustrative only: ~KES {BETA_RATE_KES_PER_MINUTE}/min + ~KES{" "}
          {BETA_LINE_FEE_KES_PER_MONTH.toLocaleString("en-KE")}/mo line fee when we turn billing
          on. Nothing is deducted during free beta.
        </p>
        {usage.daysRemainingAtPace != null ? (
          <p className="mt-2 text-sm text-[var(--ink)]">
            At your current call volume, a KES {usage.telecomBalanceKes.toLocaleString("en-KE")}{" "}
            telecom balance would last about <strong>{usage.daysRemainingAtPace} days</strong>.
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Add a telecom balance (via platform ops) to see how long it would last at your pace.
          </p>
        )}
      </section>
    </div>
  );
}
