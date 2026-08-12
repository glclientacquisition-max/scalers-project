import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  callsHref,
  nairobiDayStartIso,
  nairobiGreeting,
  walletKes,
} from "@/lib/callsTriage";

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
        "block rounded-2xl border px-6 py-7 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2",
        warn
          ? "border-warn/45 bg-warn-soft hover:border-warn"
          : "border-line bg-surface hover:border-[#0096FF]/45",
      ].join(" ")}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </p>
      <p
        className={[
          "mt-3 font-display text-4xl tracking-tight sm:text-[2.75rem]",
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
    <div className="mx-auto max-w-2xl px-1 py-6 sm:py-12">
      <header className="text-center">
        <p className="text-sm text-ink-soft">
          {greeting},{" "}
          <span className="font-medium text-ink">{business}</span>
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-ink sm:text-4xl">
          Overview
        </h1>
      </header>

      <section
        aria-label="Executive summary"
        className="mt-14 grid gap-4 sm:grid-cols-2"
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

      <div className="mt-14 flex justify-center px-2">
        <Link
          href="/calls"
          className="inline-flex min-h-[3.25rem] w-full max-w-md items-center justify-center rounded-xl bg-[#0096FF] px-8 py-3.5 text-base font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2"
        >
          Process Pending Leads
        </Link>
      </div>

      {!leadStatusReady ? (
        <p className="mx-auto mt-10 max-w-md text-center text-xs text-ink-soft">
          Lead statuses need{" "}
          <code className="text-[11px]">docs/supabase/lead_status.sql</code>.
        </p>
      ) : null}
    </div>
  );
}
