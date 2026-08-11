import Link from "next/link";
import type { TenantRow } from "@/lib/supabase";
import {
  callsHref,
  followUpWhatsAppMessage,
  formatCallWhen,
  nairobiGreeting,
  walletKes,
  type Lead,
  type StatusFilterId,
} from "@/lib/callsTriage";
import { MarkLeadDoneButton } from "@/components/MarkLeadDoneButton";
import { WhatsAppLink } from "@/components/WhatsAppLink";

type Mode = "pending_did" | "ready_empty" | "needs_you" | "caught_up";

function resolveMode(opts: {
  pendingDid: boolean;
  totalCalls: number;
  newCount: number;
}): Mode {
  if (opts.pendingDid) return "pending_did";
  if (opts.totalCalls === 0) return "ready_empty";
  if (opts.newCount > 0) return "needs_you";
  return "caught_up";
}

/**
 * First-open workspace briefing: one job, one next action, then needs-you queue.
 * Keeps owners oriented without card clutter or a separate /home route.
 */
export function CallsCommandCenter({
  tenant,
  todayCount,
  newCount,
  totalCalls,
  urgentNew,
  needsYou,
  leadStatusReady,
}: {
  tenant: TenantRow;
  todayCount: number;
  newCount: number;
  totalCalls: number;
  urgentNew: number;
  needsYou: Lead[];
  leadStatusReady: boolean;
}) {
  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith("pending:");
  const did = tenant.sautikit_virtual_number || "";
  const mode = resolveMode({ pendingDid, totalCalls, newCount });
  const kes = walletKes(tenant);
  const lowWallet = kes < 200;
  const greeting = nairobiGreeting();
  const business = tenant.business_name?.trim() || "your workspace";

  const headline =
    mode === "pending_did"
      ? "Your number is being assigned"
      : mode === "ready_empty"
        ? "Your line is live — place a test call"
        : mode === "needs_you"
          ? `${newCount} lead${newCount === 1 ? "" : "s"} need${newCount === 1 ? "s" : ""} you`
          : "You're caught up";

  const support =
    mode === "pending_did"
      ? "Keep training the receptionist. Leads will land here the moment the line is ready."
      : mode === "ready_empty"
        ? `Call ${did} from another phone. Captured name + reason appear here for triage.`
        : mode === "needs_you"
          ? urgentNew > 0
            ? `${urgentNew} marked urgent. Reply on WhatsApp while they're hot.`
            : "Follow up on WhatsApp, then mark Contacted or Done."
          : todayCount > 0
            ? `${todayCount} call${todayCount === 1 ? "" : "s"} today. Post a bulletin or refine training anytime.`
            : "No calls yet today. Test the line or update today's bulletin.";

  const primary =
    mode === "pending_did"
      ? { href: "/settings#train", label: "Train receptionist", solid: true }
      : mode === "ready_empty"
        ? { href: `tel:${did}`, label: "Call your line", solid: true }
        : mode === "needs_you"
          ? {
              href: callsHref({ status: "new" }),
              label: "Review new leads",
              solid: true,
            }
          : { href: "/settings#today", label: "Post today's update", solid: false };

  return (
    <section aria-label="Workspace briefing" className="mt-2">
      <p className="text-sm text-ink-soft">
        {greeting}, <span className="font-medium text-ink">{business}</span>
      </p>
      <h1 className="mt-1 font-display text-3xl tracking-tight text-ink sm:text-4xl">
        {headline}
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft sm:text-base">
        {support}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {primary.href.startsWith("tel:") ? (
          <a
            href={primary.href}
            className={[
              "inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
              primary.solid
                ? "bg-accent text-white hover:bg-accent-deep"
                : "border border-line text-accent-deep hover:border-accent",
            ].join(" ")}
          >
            {primary.label}
          </a>
        ) : (
          <Link
            href={primary.href}
            className={[
              "inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
              primary.solid
                ? "bg-accent text-white hover:bg-accent-deep"
                : "border border-line text-accent-deep hover:border-accent",
            ].join(" ")}
          >
            {primary.label}
          </Link>
        )}
        {!pendingDid && mode !== "ready_empty" ? (
          <a
            href={`tel:${did}`}
            className="text-sm font-medium text-accent-deep underline decoration-accent/30 underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
          >
            {did}
          </a>
        ) : null}
      </div>

      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-y border-line/80 py-4 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-soft">Today</dt>
          <dd className="mt-0.5 font-display text-xl text-ink">{todayCount}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-soft">Waiting</dt>
          <dd className={["mt-0.5 font-display text-xl", newCount > 0 ? "text-warn" : "text-ink"].join(" ")}>
            {newCount}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-soft">Line</dt>
          <dd className="mt-0.5 font-medium text-ink">
            {pendingDid ? "Pending" : "Live"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-soft">Wallet</dt>
          <dd className="mt-0.5">
            <Link
              href="/wallet"
              className={[
                "font-medium focus-visible:outline-none focus-visible:shadow-focus",
                lowWallet ? "text-warn" : "text-ink hover:text-accent-deep",
              ].join(" ")}
            >
              KES {kes.toLocaleString("en-KE")}
              {lowWallet ? " · low" : ""}
            </Link>
          </dd>
        </div>
      </dl>

      <nav aria-label="Quick actions" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/settings#test" className="font-medium text-accent-deep hover:underline">
          How to test
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

      {leadStatusReady && needsYou.length > 0 ? (
        <div className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-xl tracking-tight text-ink">Needs you now</h2>
            {newCount > needsYou.length ? (
              <Link
                href={callsHref({ status: "new" })}
                className="text-sm font-medium text-accent-deep hover:underline"
              >
                View all {newCount} new
              </Link>
            ) : null}
          </div>
          <ul className="mt-3 divide-y divide-line/80 border-y border-line/80">
            {needsYou.map((lead) => (
              <NeedsYouRow key={lead.call.id} lead={lead} businessName={business} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function NeedsYouRow({ lead, businessName }: { lead: Lead; businessName: string }) {
  const message = followUpWhatsAppMessage({
    businessName,
    name: lead.name,
    reason: lead.reason,
  });

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs text-ink-soft">{formatCallWhen(lead.call.created_at)}</p>
        <p className="mt-0.5 truncate font-medium text-ink">
          {lead.name || lead.call.caller_number}
          {lead.urgent ? (
            <span className="ml-2 align-middle text-xs font-medium text-warn">urgent</span>
          ) : null}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">
          {lead.reason || "No reason captured yet"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WhatsAppLink number={lead.call.caller_number} compact message={message} />
        <MarkLeadDoneButton callId={lead.call.id} />
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

export function CallsToolbar({
  active,
  counts,
  q,
}: {
  active: StatusFilterId;
  counts: { all: number; new: number; contacted: number; resolved: number };
  q: string;
}) {
  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl tracking-tight text-ink">Inbox</h2>
        <form action="/calls" method="get" className="flex min-w-[min(100%,18rem)] flex-1 justify-end gap-2 sm:max-w-xs">
          <input type="hidden" name="status" value={active} />
          <label className="sr-only" htmlFor="calls-search">
            Search callers
          </label>
          <input
            id="calls-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search name, number, reason"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus-visible:shadow-focus"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent focus-visible:outline-none focus-visible:shadow-focus"
          >
            Search
          </button>
        </form>
      </div>

      <nav aria-label="Filter by follow-up status" className="mt-4 border-b border-line">
        <ul className="flex gap-1 overflow-x-auto">
          {(
            [
              { id: "all" as const, label: "All" },
              { id: "new" as const, label: "New" },
              { id: "contacted" as const, label: "Contacted" },
              { id: "resolved" as const, label: "Resolved" },
            ] as const
          ).map((item) => {
            const isActive = active === item.id;
            return (
              <li key={item.id}>
                <Link
                  href={callsHref({ status: item.id, q: q || undefined })}
                  aria-current={isActive ? "page" : undefined}
                  className={[
                    "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
                    isActive
                      ? "border-accent text-accent-deep"
                      : "border-transparent text-ink-soft hover:border-line hover:text-ink",
                  ].join(" ")}
                >
                  {item.label}
                  <span className={["tabular-nums text-xs", isActive ? "text-accent-deep" : "text-ink-soft"].join(" ")}>
                    {counts[item.id]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {q ? (
        <p className="mt-3 text-sm text-ink-soft">
          Showing matches for <span className="font-medium text-ink">&ldquo;{q}&rdquo;</span>.{" "}
          <Link href={callsHref({ status: active })} className="font-medium text-accent-deep hover:underline">
            Clear search
          </Link>
        </p>
      ) : null}
    </div>
  );
}
