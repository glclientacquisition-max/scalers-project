import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  MarkLeadArchiveButton,
  MarkLeadDoneButton,
} from "@/components/MarkLeadDoneButton";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import {
  callsHref,
  followUpWhatsAppMessage,
  formatCallWhen,
  nairobiDayStartIso,
  nairobiGreeting,
  toLead,
  walletKes,
  type Lead,
} from "@/lib/callsTriage";
import type { CallRow } from "@/lib/supabase";

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";

function GlanceCard({
  href,
  label,
  value,
  hint,
  warn = false,
}: {
  href: string;
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "block rounded-2xl border px-4 py-4 transition focus-visible:outline-none focus-visible:shadow-focus",
        warn
          ? "border-warn/45 bg-warn-soft hover:border-warn"
          : "border-line bg-surface hover:border-accent/50",
      ].join(" ")}
    >
      <p className="text-xs uppercase tracking-wide text-ink-soft">{label}</p>
      <p
        className={[
          "mt-2 font-display text-3xl tracking-tight",
          warn ? "text-warn" : "text-ink",
        ].join(" ")}
      >
        {value}
      </p>
      <p className={["mt-1 text-xs", warn ? "text-warn" : "text-ink-soft"].join(" ")}>
        {hint}
      </p>
    </Link>
  );
}

function ActionCard({
  href,
  title,
  body,
  cta,
  solid = false,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
  solid?: boolean;
}) {
  const isTel = href.startsWith("tel:");
  const className = [
    "mt-4 inline-flex min-h-10 items-center rounded-xl px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
    solid
      ? "bg-accent text-white hover:bg-accent-deep"
      : "border border-line text-accent-deep hover:border-accent",
  ].join(" ");

  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-5">
      <h2 className="font-display text-xl tracking-tight text-ink">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
      {isTel ? (
        <a href={href} className={className}>
          {cta}
        </a>
      ) : (
        <Link href={href} className={className}>
          {cta}
        </Link>
      )}
    </div>
  );
}

function TriageCard({ lead, businessName }: { lead: Lead; businessName: string }) {
  const message = followUpWhatsAppMessage({
    businessName,
    name: lead.name,
    reason: lead.reason,
  });

  return (
    <li
      className={[
        "rounded-2xl border bg-surface p-4",
        lead.urgent ? "border-warn/50 bg-warn-soft" : "border-line",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-soft">{formatCallWhen(lead.call.created_at)}</p>
          <p className="mt-1 truncate text-base font-medium text-ink">
            {lead.name || lead.call.caller_number}
            {lead.urgent ? (
              <span className="ml-2 align-middle text-xs font-medium text-warn">urgent</span>
            ) : null}
          </p>
          <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">
            {lead.reason || "No reason captured yet"}
          </p>
        </div>
        <WhatsAppLink number={lead.call.caller_number} compact message={message} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <MarkLeadDoneButton callId={lead.call.id} />
        <MarkLeadArchiveButton callId={lead.call.id} />
        <Link
          href={`/calls/${lead.call.id}?from=new`}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-accent hover:border-accent focus-visible:outline-none focus-visible:shadow-focus"
        >
          Open
        </Link>
      </div>
    </li>
  );
}

function resolveNextAction(opts: {
  pendingDid: boolean;
  did: string;
  newCount: number;
  totalCalls: number;
}) {
  if (opts.pendingDid) {
    return {
      title: "Finish setup",
      body: "Your number is being assigned. Train the receptionist so the first calls sound right.",
      href: "/settings#train",
      cta: "Train receptionist",
      solid: true,
    };
  }
  if (opts.totalCalls === 0) {
    return {
      title: "Place a test call",
      body: `Call ${opts.did} from another phone. Captured leads will appear here for triage.`,
      href: `tel:${opts.did}`,
      cta: "Call your line",
      solid: true,
    };
  }
  if (opts.newCount > 0) {
    return {
      title: "Lead triage",
      body: `${opts.newCount} new lead${opts.newCount === 1 ? "" : "s"} waiting. Follow up on WhatsApp, then mark Done or Archive.`,
      href: callsHref({ status: "new" }),
      cta: "Open new leads",
      solid: true,
    };
  }
  return {
    title: "You're caught up",
    body: "No new leads right now. Post today’s update or refine training anytime.",
    href: "/settings#today",
    cta: "Post today's update",
    solid: false,
  };
}

export default async function HomeDashboardPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-ink-soft">
        No workspace linked to this account yet.{" "}
        <Link href="/signup" className="text-accent">
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
  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith("pending:");
  const did = tenant.sautikit_virtual_number || "";
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

  const leadStatusReady = !(
    newRes.error && /lead_status|column/i.test(newRes.error.message)
  );
  const archiveReady = !(
    archivedRes.error && /lead_status|archived|check/i.test(archivedRes.error.message)
  );

  const todayCount = todayRes.count ?? 0;
  const newCount = leadStatusReady ? newRes.count ?? 0 : 0;
  const followedCount = leadStatusReady ? followedRes.count ?? 0 : 0;
  const doneCount = leadStatusReady ? doneRes.count ?? 0 : 0;
  const archivedCount = archiveReady ? archivedRes.count ?? 0 : 0;
  const activeTotal = leadStatusReady
    ? allRes.count ?? 0
    : todayCount;

  let needsYou: Lead[] = [];
  if (leadStatusReady && needsRes.data && !needsRes.error) {
    needsYou = (needsRes.data as CallRow[])
      .map(toLead)
      .sort((a, b) => Number(b.urgent) - Number(a.urgent))
      .slice(0, 5);
  }

  const next = resolveNextAction({
    pendingDid,
    did,
    newCount,
    totalCalls: activeTotal + (archiveReady ? archivedCount : 0),
  });

  const greeting = nairobiGreeting();

  return (
    <div className="max-w-4xl">
      <p className="text-sm text-ink-soft">
        {greeting}, <span className="font-medium text-ink">{business}</span>
      </p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-ink sm:text-4xl">
        Dashboard
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft sm:text-base">
        Lead triage, balance, and your next step — at a glance.
      </p>

      <section
        aria-label="Key numbers"
        className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <GlanceCard
          href={callsHref({ status: "new" })}
          label="Waiting"
          value={String(newCount)}
          hint={newCount > 0 ? "New leads to triage" : "Inbox clear"}
          warn={newCount > 0}
        />
        <GlanceCard
          href={callsHref({ status: "contacted" })}
          label="Followed Up"
          value={String(followedCount)}
          hint="In progress"
        />
        <GlanceCard
          href={callsHref()}
          label="Today"
          value={String(todayCount)}
          hint="Calls since midnight EAT"
        />
        <GlanceCard
          href="/wallet"
          label="Balance"
          value={`KES ${kes.toLocaleString("en-KE")}`}
          hint={lowWallet ? "Low — top up soon" : "Prepaid wallet"}
          warn={lowWallet}
        />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ActionCard
          href={next.href}
          title={next.title}
          body={next.body}
          cta={next.cta}
          solid={next.solid}
        />
        <div className="rounded-2xl border border-line bg-surface px-5 py-5">
          <h2 className="font-display text-xl tracking-tight text-ink">Line & tools</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Receptionist line</dt>
              <dd className="font-medium text-ink">
                {pendingDid ? "Pending" : did || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Done</dt>
              <dd className="font-medium text-ink">{doneCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Archived</dt>
              <dd className="font-medium text-ink">
                {archiveReady ? archivedCount : "—"}
              </dd>
            </div>
          </dl>
          <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link href="/calls" className="font-medium text-accent-deep hover:underline">
              Inbox
            </Link>
            <Link href="/requests" className="font-medium text-accent-deep hover:underline">
              Requests
            </Link>
            <Link href="/settings#today" className="font-medium text-accent-deep hover:underline">
              Today&apos;s update
            </Link>
            <Link href="/settings#train" className="font-medium text-accent-deep hover:underline">
              Train
            </Link>
            <Link href="/wallet" className="font-medium text-accent-deep hover:underline">
              Wallet
            </Link>
          </nav>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-display text-2xl tracking-tight text-ink">Lead triage</h2>
          <Link
            href={callsHref({ status: "new" })}
            className="text-sm font-medium text-accent-deep hover:underline"
          >
            {newCount > 0 ? `View all ${newCount} new` : "Open inbox"}
          </Link>
        </div>

        {!leadStatusReady ? (
          <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink-soft">
            Lead statuses need{" "}
            <code>docs/supabase/lead_status.sql</code>. Archive needs{" "}
            <code>docs/supabase/lead_status_archive.sql</code>.
          </p>
        ) : needsYou.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-line bg-surface px-5 py-8 text-center">
            <p className="font-display text-xl text-ink">No leads waiting</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
              New callers will show here with WhatsApp, Done, and Archive actions.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {needsYou.map((lead) => (
              <TriageCard key={lead.call.id} lead={lead} businessName={business} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
