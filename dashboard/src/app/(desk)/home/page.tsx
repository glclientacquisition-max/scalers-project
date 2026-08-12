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
        "block min-w-0 rounded-2xl border px-4 py-6 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2 sm:px-6 sm:py-7",
        warn
          ? "border-warn/45 bg-warn-soft hover:border-warn"
          : "border-line bg-surface hover:border-[#0096FF]/45",
      ].join(" ")}
    >
      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-soft sm:text-xs">
        {label}
      </p>
      <p
        className={[
          "mt-2 font-display tracking-tight [overflow-wrap:anywhere] sm:mt-3",
          "text-[clamp(1.75rem,6vw,2.75rem)]",
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
    <div className="mx-auto w-full min-w-0 max-w-2xl py-6 sm:py-12">
      <header className="min-w-0 text-center">
        <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
          {greeting},{" "}
          <span className="font-medium text-ink">{business}</span>
        </p>
        <h1 className="mt-2 font-display tracking-tight text-ink text-[clamp(1.75rem,5vw,2.25rem)]">
          Overview
        </h1>
      </header>

      {primaryUpdate ? (
        <aside
          aria-label="Live updates"
          className="mx-auto mt-8 w-full min-w-0 max-w-md text-center"
        >
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-[#005ccc] sm:text-xs">
            Live update
            {liveUpdates.length > 1 ? ` · ${liveUpdates.length}` : ""}
          </p>
          <p className="mt-2 text-sm font-medium leading-snug text-ink [overflow-wrap:anywhere]">
            {primaryUpdate.text}
          </p>
          <p className="mt-1 text-xs text-ink-soft [overflow-wrap:anywhere]">
            {formatBulletinEndLabel(primaryUpdate.ends_at)}
            {liveUpdates.length > 1
              ? ` · +${liveUpdates.length - 1} more`
              : ""}
          </p>
          <Link
            href={businessSettingsHref("updates")}
            className="mt-3 inline-flex min-h-11 items-center justify-center px-2 text-sm font-medium text-[#0096FF] hover:text-[#005ccc] focus-visible:outline-none focus-visible:underline"
          >
            Manage updates
          </Link>
        </aside>
      ) : null}

      <section
        aria-label="Executive summary"
        className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4 sm:mt-14"
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

      <div className="mt-10 flex justify-center sm:mt-14">
        <Link
          href="/calls"
          className="inline-flex min-h-12 w-full max-w-md items-center justify-center rounded-xl bg-[#0096FF] px-6 py-3.5 text-base font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2 sm:px-8"
        >
          Process Pending Leads
        </Link>
      </div>

      {!leadStatusReady ? (
        <p className="mx-auto mt-10 max-w-md text-center text-xs text-ink-soft [overflow-wrap:anywhere]">
          Lead statuses need{" "}
          <code className="text-[0.6875rem]">docs/supabase/lead_status.sql</code>.
        </p>
      ) : null}
    </div>
  );
}
