import Link from "next/link";
import { TriageLeadCard } from "@/components/TriageLeadCard";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import {
  callsHref,
  nairobiDayStartIso,
  nairobiGreeting,
  toLead,
  walletKes,
} from "@/lib/callsTriage";
import {
  formatBulletinEndLabel,
  liveBulletinItems,
} from "@/lib/dailyBulletin";
import type { CallRow } from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { WALLET_LOW_BALANCE_KES } from "@/lib/wallet";
import {
  HOME_LEAD_LIMIT,
  assessTenantAnswerReadiness,
  firstTrainingGap,
  homeNextAction,
  lineStatusFromDid,
  trainingGapLabel,
} from "./commandCenter";

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status, resolution, primary_intent, resolution_note";
const CALL_SELECT_LEAD =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";

function isLeadStatusColumnError(message: string): boolean {
  return /lead_status|column/i.test(message);
}

function StatLink({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: number;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-baseline justify-between gap-3 rounded-lg px-1 py-1 text-sm text-ink-soft transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
    >
      <span>{label}</span>
      <span className="tabular-nums font-medium text-ink">{value}</span>
    </Link>
  );
}

export default async function HomeOverviewPage() {
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

  const client = workspace.client;
  const dayStart = nairobiDayStartIso();
  const businessName = tenant.business_name?.trim() || "your workspace";
  const liveUpdates = liveBulletinItems(tenant.daily_bulletin);
  const primaryUpdate = liveUpdates[0] ?? null;

  const kes = walletKes(tenant);
  const isBeta = tenant.billing_enforcement === "off";
  const lowThreshold = Number(tenant.wallet_low_balance_kes ?? WALLET_LOW_BALANCE_KES);
  const walletLow = !isBeta && kes < lowThreshold;

  const line = lineStatusFromDid(tenant.sautikit_virtual_number);
  const readiness = assessTenantAnswerReadiness(tenant);
  const trainingGap = firstTrainingGap(readiness.items, line);

  const countEq = (status: string) =>
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("lead_status", status);

  const [todayRes, newRes, followedRes, totalRes, leadsRes] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    countEq("new"),
    countEq("contacted"),
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
    client
      .from("calls")
      .select(CALL_SELECT)
      .eq("tenant_id", tenant.id)
      .eq("lead_status", "new")
      .order("created_at", { ascending: false })
      .limit(HOME_LEAD_LIMIT),
  ]);

  let leadRows = (leadsRes.data || []) as CallRow[];
  let leadsError = leadsRes.error;
  if (leadsError && !isLeadStatusColumnError(leadsError.message)) {
    const retry = await client
      .from("calls")
      .select(CALL_SELECT_LEAD)
      .eq("tenant_id", tenant.id)
      .eq("lead_status", "new")
      .order("created_at", { ascending: false })
      .limit(HOME_LEAD_LIMIT);
    leadRows = (retry.data || []) as CallRow[];
    leadsError = retry.error;
  }

  const leadStatusReady = !(
    (newRes.error && isLeadStatusColumnError(newRes.error.message)) ||
    (leadsError && isLeadStatusColumnError(leadsError.message))
  );

  const todayCount = todayRes.error ? null : todayRes.count ?? 0;
  const newCount = newRes.error || !leadStatusReady ? null : newRes.count ?? 0;
  const followedCount =
    followedRes.error || !leadStatusReady ? null : followedRes.count ?? 0;
  const totalCalls = totalRes.error ? null : totalRes.count ?? 0;

  const leads = leadRows.map(toLead);
  const queueError = Boolean(leadsError);
  const next = homeNextAction({
    newLeadCount: newCount ?? leads.length,
    line,
    trainingGapId: trainingGap?.id ?? null,
    walletLow,
    totalCalls,
  });

  return (
    <div className="min-w-0">
      <header className="min-w-0">
        <h1 className="font-display text-[clamp(1.375rem,3vw,1.75rem)] tracking-tight text-ink [overflow-wrap:anywhere]">
          {nairobiGreeting()}, {businessName}
        </h1>
      </header>

      {primaryUpdate ? (
        <aside aria-label="Updates" className="mt-4 w-full min-w-0">
          <div className="relative overflow-hidden rounded-2xl border border-[#0096FF]/25 bg-[color-mix(in_srgb,var(--accent-soft)_70%,white)] px-3 py-3 sm:px-4">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-[#0096FF]"
            />
            <div className="flex min-w-0 flex-col gap-3 pl-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="relative inline-flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0096FF]/40 motion-reduce:animate-none" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0096FF]" />
                    </span>
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[#005ccc]">
                      Updates
                      {liveUpdates.length > 1 ? (
                        <span className="font-medium normal-case tracking-normal text-ink-soft">
                          {` · ${liveUpdates.length}`}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <p className="text-xs text-ink-soft [overflow-wrap:anywhere]">
                    {formatBulletinEndLabel(primaryUpdate.ends_at)}
                  </p>
                </div>
                <p className="mt-2 font-display text-[clamp(0.95rem,2.4vw,1.125rem)] leading-snug tracking-tight text-ink [overflow-wrap:anywhere]">
                  {primaryUpdate.text}
                </p>
              </div>
              <Link
                href={businessSettingsHref("updates")}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-[#0096FF]/35 bg-white px-4 text-sm font-semibold text-[#0096FF] transition hover:border-[#0096FF] hover:bg-[#0096FF]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2"
              >
                Manage
              </Link>
            </div>
          </div>
        </aside>
      ) : null}

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-8" aria-labelledby="new-leads-heading">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <h2
              id="new-leads-heading"
              className="font-display text-xl tracking-tight text-ink"
            >
              New call leads
            </h2>
            {newCount != null && newCount > 0 ? (
              <span className="tabular-nums text-sm text-ink-soft">{newCount}</span>
            ) : null}
          </div>
          {newCount != null && newCount > leads.length ? (
            <p className="mt-1">
              <Link
                href={callsHref({ status: "new" })}
                className="text-sm font-medium text-[#0096FF] hover:text-[#005ccc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
              >
                All new
              </Link>
            </p>
          ) : null}

          {queueError || !leadStatusReady ? (
            <div className="mt-4 border-y border-line py-10 text-center">
              <p className="font-display text-xl tracking-tight text-ink">
                New call leads could not be loaded
              </p>
            </div>
          ) : leads.length === 0 ? (
            <div className="mt-4 border-y border-line py-10 text-center">
              <p className="font-display text-xl tracking-tight text-ink">
                No new call leads
              </p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {leads.map((lead) => (
                <TriageLeadCard
                  key={lead.call.id}
                  lead={lead}
                  businessName={tenant.business_name?.trim() || "us"}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4 lg:sticky lg:top-24">
          {todayCount != null || followedCount != null ? (
            <section aria-label="Activity">
              <ul>
                {todayCount != null ? (
                  <li>
                    <StatLink
                      href={callsHref({ status: "all" })}
                      label="Calls today"
                      value={todayCount}
                    />
                  </li>
                ) : null}
                {followedCount != null ? (
                  <li>
                    <StatLink
                      href={callsHref({ status: "contacted" })}
                      label="Followed up"
                      value={followedCount}
                    />
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="line-heading">
            <h2
              id="line-heading"
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft"
            >
              Line
            </h2>
            <p className="mt-2 text-sm font-medium text-ink">
              {line === "line_live" ? "Line live" : "Number pending"}
            </p>
            {line === "line_live" ? (
              <p className="mt-0.5 truncate font-mono text-xs text-ink-soft">
                {tenant.sautikit_virtual_number}
              </p>
            ) : null}
            {line === "line_live" && !trainingGap ? (
              <p className="mt-2 text-sm text-ink-soft">
                Your assistant can take calls.
              </p>
            ) : null}
            {trainingGap ? (
              <p className="mt-2 text-sm text-ink">
                Needs training
                <span className="block text-xs font-normal text-ink-soft">
                  {trainingGapLabel(trainingGap.id)}
                </span>
              </p>
            ) : null}
            {walletLow ? (
              <Link
                href="/wallet"
                className="mt-2 block text-sm text-warn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
              >
                Wallet low
                <span className="block font-mono text-xs font-normal">
                  KES {kes.toLocaleString("en-KE")}
                </span>
              </Link>
            ) : null}
          </section>

          <Link
            href={next.href}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0096FF] px-6 py-3 text-base font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2"
          >
            {next.label}
          </Link>
        </aside>
      </div>
    </div>
  );
}
