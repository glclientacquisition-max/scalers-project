import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callsHref,
  nairobiDayStartIso,
  nairobiGreeting,
  walletKes,
} from "@/lib/callsTriage";
import {
  formatBulletinEndLabel,
  liveBulletinItems,
} from "@/lib/dailyBulletin";
import { businessSettingsHref } from "@/lib/businessSettingsNav";

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";

function MetricCard({
  href,
  label,
  value,
  warn = false,
}: {
  href: string;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "flex min-h-[5.5rem] min-w-0 flex-col justify-center rounded-2xl border px-3 py-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2 sm:min-h-[6.5rem] sm:px-4 sm:py-4",
        warn
          ? "border-warn/45 bg-warn-soft hover:border-warn"
          : "border-line bg-surface hover:border-[#0096FF]/45",
      ].join(" ")}
    >
      <p className="text-[0.625rem] font-medium uppercase tracking-wide text-ink-soft sm:text-[0.6875rem]">
        {label}
      </p>
      <p
        className={[
          "mt-1 font-display tracking-tight [overflow-wrap:anywhere]",
          "text-[clamp(1.35rem,4.5vw,2rem)]",
          warn ? "text-warn" : "text-ink",
        ].join(" ")}
      >
        {value}
      </p>
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
  const kes = walletKes(tenant);
  const lowWallet = kes < 200;
  const business = tenant.business_name?.trim() || "your workspace";
  const liveUpdates = liveBulletinItems(tenant.daily_bulletin);
  const primaryUpdate = liveUpdates[0] ?? null;

  const countEq = (status: string) =>
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("lead_status", status);

  const [todayRes, allRes, newRes, followedRes, doneRes, archivedRes, needsRes] =
    await Promise.all([
      client
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .gte("created_at", dayStart),
      client
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .neq("lead_status", "archived"),
      countEq("new"),
      countEq("contacted"),
      countEq("resolved"),
      countEq("archived"),
      client
        .from("calls")
        .select(CALL_SELECT)
        .eq("tenant_id", tenant.id)
        .eq("lead_status", "new")
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

  void allRes;
  void doneRes;
  void archivedRes;
  void needsRes;

  const leadStatusReady = !(
    newRes.error && /lead_status|column/i.test(newRes.error.message)
  );

  const todayCount = todayRes.count ?? 0;
  const newCount = leadStatusReady ? newRes.count ?? 0 : 0;
  const followedCount = leadStatusReady ? followedRes.count ?? 0 : 0;

  const greeting = nairobiGreeting();

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl py-4 sm:py-8">
      <header className="min-w-0 text-center sm:text-left">
        <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
          {greeting},{" "}
          <span className="font-medium text-ink">{business}</span>
        </p>
        <h1 className="mt-1 font-display tracking-tight text-ink text-[clamp(1.625rem,4vw,2rem)]">
          Overview
        </h1>
      </header>

      {primaryUpdate ? (
        <aside aria-label="Live updates" className="mt-5 w-full min-w-0">
          <div className="relative overflow-hidden rounded-2xl border border-[#0096FF]/25 bg-[color-mix(in_srgb,var(--accent-soft)_70%,white)] px-3 py-3 sm:px-4 sm:py-3.5">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-[#0096FF]"
            />
            <div className="flex min-w-0 flex-col gap-3 pl-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="relative inline-flex h-2 w-2 shrink-0"
                    >
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0096FF]/40" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0096FF]" />
                    </span>
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[#005ccc]">
                      Updates
                      <span className="font-medium normal-case tracking-normal text-ink-soft">
                        {liveUpdates.length > 1
                          ? ` · ${liveUpdates.length} live`
                          : " · live"}
                      </span>
                    </p>
                  </div>
                  <p className="text-xs text-ink-soft [overflow-wrap:anywhere]">
                    {formatBulletinEndLabel(primaryUpdate.ends_at)}
                    {liveUpdates.length > 1
                      ? ` · +${liveUpdates.length - 1} more`
                      : ""}
                  </p>
                </div>
                <p className="mt-2 font-display leading-snug tracking-tight text-ink [overflow-wrap:anywhere] text-[clamp(0.95rem,2.4vw,1.125rem)]">
                  {primaryUpdate.text}
                </p>
              </div>
              <Link
                href={businessSettingsHref("updates")}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-[#0096FF]/35 bg-white px-4 text-sm font-semibold text-[#0096FF] transition hover:border-[#0096FF] hover:bg-[#0096FF]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2"
              >
                Manage
              </Link>
            </div>
          </div>
        </aside>
      ) : null}

      <section
        aria-label="Executive summary"
        className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 lg:grid-cols-4"
      >
        <MetricCard
          href={callsHref({ status: "new" })}
          label="New Leads Waiting"
          value={String(newCount)}
          warn={newCount > 0}
        />
        <MetricCard
          href={callsHref({ status: "contacted" })}
          label="Followed Up / In Progress"
          value={String(followedCount)}
        />
        <MetricCard
          href={callsHref()}
          label="Calls Today"
          value={String(todayCount)}
        />
        <MetricCard
          href="/wallet"
          label="Wallet Balance"
          value={`KES ${kes.toLocaleString("en-KE")}`}
          warn={lowWallet}
        />
      </section>

      <div className="mt-5 sm:mt-6">
        <Link
          href="/calls"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0096FF] px-6 py-3 text-base font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2"
        >
          Process Pending Leads
        </Link>
      </div>

      {!leadStatusReady ? (
        <p className="mt-6 text-center text-xs text-ink-soft [overflow-wrap:anywhere] sm:text-left">
          Lead statuses need{" "}
          <code className="text-[0.6875rem]">docs/supabase/lead_status.sql</code>.
        </p>
      ) : null}
    </div>
  );
}
