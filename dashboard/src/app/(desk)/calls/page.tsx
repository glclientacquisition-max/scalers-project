import Link from "next/link";
import {
  type CallRow,
  type LeadStatus,
} from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  CallsCommandCenter,
  CallsToolbar,
} from "@/components/CallsCommandCenter";
import { LeadStatusToggle } from "@/components/LeadStatusToggle";
import { MarkLeadDoneButton } from "@/components/MarkLeadDoneButton";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import {
  callsHref,
  followUpWhatsAppMessage,
  formatCallWhen,
  nairobiDayStartIso,
  resolveStatusFilter,
  sanitizeSearchQuery,
  toLead,
  type Lead,
  type StatusFilterId,
} from "@/lib/callsTriage";

function EmptyCalls({
  total,
  pendingDid,
  did,
  statusFilter,
  q,
}: {
  total: number;
  pendingDid: boolean;
  did: string;
  statusFilter: StatusFilterId;
  q: string;
}) {
  if (total > 0) {
    return (
      <div className="mt-6 border-y border-line py-10 text-center text-ink-soft">
        No calls on this page.
      </div>
    );
  }

  if (q) {
    return (
      <div className="mt-6 border-y border-line py-10 text-center">
        <p className="font-display text-xl tracking-tight text-ink">No matches</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          Nothing matched &ldquo;{q}&rdquo; in this filter.
        </p>
        <Link
          href={callsHref({ status: statusFilter })}
          className="mt-5 inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-accent-deep transition hover:border-accent focus-visible:outline-none focus-visible:shadow-focus"
        >
          Clear search
        </Link>
      </div>
    );
  }

  if (statusFilter !== "all") {
    const label =
      statusFilter === "new"
        ? "new leads"
        : statusFilter === "contacted"
          ? "contacted leads"
          : "resolved leads";
    return (
      <div className="mt-6 border-y border-line py-10 text-center">
        <p className="font-display text-xl tracking-tight text-ink">No {label}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          Nothing in this follow-up bucket right now.
        </p>
        <Link
          href={callsHref({ status: "all" })}
          className="mt-5 inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-accent-deep transition hover:border-accent focus-visible:outline-none focus-visible:shadow-focus"
        >
          Show all calls
        </Link>
      </div>
    );
  }

  if (pendingDid) {
    return (
      <div className="mt-6 border-y border-accent/30 bg-accent-soft/40 py-10 text-center">
        <p className="font-display text-xl tracking-tight text-ink">Number being assigned</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          Train the business profile now. Once the number is live, test calls land here.
        </p>
        <Link
          href="/settings#train"
          className="mt-5 inline-flex rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-deep focus-visible:outline-none focus-visible:shadow-focus"
        >
          Train receptionist
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 border-y border-line py-10 text-center text-ink-soft">
      <p className="font-display text-xl tracking-tight text-ink">No calls yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm">
        Place a test call to{" "}
        <a
          href={`tel:${did}`}
          className="font-medium text-accent-deep underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {did}
        </a>{" "}
        from another phone.
      </p>
      <Link
        href="/settings#test"
        className="mt-5 inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-accent-deep transition hover:border-accent focus-visible:outline-none focus-visible:shadow-focus"
      >
        How to test
      </Link>
    </div>
  );
}

function StatusBadges({ lead }: { lead: Lead }) {
  return (
    <span className="inline-flex items-center gap-2">
      {lead.notified ? <span className="text-xs text-ok">alerted</span> : null}
      {lead.urgent ? (
        <span className="text-xs font-medium text-warn">urgent</span>
      ) : null}
    </span>
  );
}

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";
const CALL_SELECT_LEGACY =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const NEEDS_YOU_LIMIT = 5;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const q = sanitizeSearchQuery(sp.q);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

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

  let leadStatusReady = true;
  const dayStart = nairobiDayStartIso();
  const client = workspace.client;
  const businessName = tenant.business_name?.trim() || "us";

  const statusCountQuery = (status: LeadStatus) =>
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("lead_status", status);

  const [todayRes, allRes, newRes, contactedRes, resolvedRes] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
    statusCountQuery("new"),
    statusCountQuery("contacted"),
    statusCountQuery("resolved"),
  ]);

  // If lead_status column missing, counts fail — fall back gracefully below.
  if (newRes.error && /lead_status|column/i.test(newRes.error.message)) {
    leadStatusReady = false;
  }

  const newCount = leadStatusReady ? newRes.count ?? 0 : 0;
  const statusCounts = {
    all: allRes.count ?? 0,
    new: newCount,
    contacted: leadStatusReady ? contactedRes.count ?? 0 : 0,
    resolved: leadStatusReady ? resolvedRes.count ?? 0 : 0,
  };
  const activeFilter = leadStatusReady
    ? resolveStatusFilter(sp.status, newCount)
    : "all";

  let listQuery = client
    .from("calls")
    .select(CALL_SELECT, { count: "exact" })
    .eq("tenant_id", tenant.id);

  if (leadStatusReady && activeFilter !== "all") {
    listQuery = listQuery.eq("lead_status", activeFilter);
  }
  if (q) {
    listQuery = listQuery.or(
      `caller_number.ilike.%${q}%,summary.ilike.%${q}%`
    );
  }

  const first = await listQuery
    .order("created_at", { ascending: false })
    .range(from, to);

  let data = first.data as CallRow[] | null;
  let error = first.error;
  let total = first.count ?? 0;

  if (error && /lead_status|column/i.test(error.message)) {
    leadStatusReady = false;
    let retryQuery = client
      .from("calls")
      .select(CALL_SELECT_LEGACY, { count: "exact" })
      .eq("tenant_id", tenant.id);
    if (q) {
      retryQuery = retryQuery.or(
        `caller_number.ilike.%${q}%,summary.ilike.%${q}%`
      );
    }
    const retry = await retryQuery
      .order("created_at", { ascending: false })
      .range(from, to);
    data = retry.data as CallRow[] | null;
    error = retry.error;
    total = retry.count ?? 0;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Could not load calls: {error.message}
        {/row-level security|permission denied|rls/i.test(error.message) ? (
          <p className="mt-2 text-sm text-ink-soft">
            Apply docs/supabase/owner_rls.sql in Supabase if you have not yet.
          </p>
        ) : null}
      </div>
    );
  }

  let needsYou: Lead[] = [];
  let urgentNew = 0;
  if (leadStatusReady && newCount > 0) {
    const needsRes = await client
      .from("calls")
      .select(CALL_SELECT)
      .eq("tenant_id", tenant.id)
      .eq("lead_status", "new")
      .order("created_at", { ascending: false })
      .limit(40);
    if (!needsRes.error && needsRes.data) {
      const mapped = (needsRes.data as CallRow[]).map(toLead);
      urgentNew = mapped.filter((l) => l.urgent).length;
      needsYou = [...mapped]
        .sort((a, b) => Number(b.urgent) - Number(a.urgent))
        .slice(0, NEEDS_YOU_LIMIT);
    }
  }

  const leads = (data || []).map(toLead);
  const todayCount = todayRes.count ?? 0;
  const paginationParams: Record<string, string | undefined> = {
    status: activeFilter,
    q: q || undefined,
  };

  return (
    <div>
      <CallsCommandCenter
        tenant={tenant}
        todayCount={todayCount}
        newCount={newCount}
        totalCalls={statusCounts.all}
        urgentNew={urgentNew}
        needsYou={needsYou}
        leadStatusReady={leadStatusReady}
      />

      {!leadStatusReady ? (
        <p className="mt-6 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink-soft">
          Lead statuses need a one-time database update. Apply{" "}
          <code>docs/supabase/lead_status.sql</code> in Supabase.
        </p>
      ) : (
        <CallsToolbar active={activeFilter} counts={statusCounts} q={q} />
      )}

      {leads.length === 0 ? (
        <EmptyCalls
          total={total}
          pendingDid={String(tenant.sautikit_virtual_number || "").startsWith("pending:")}
          did={tenant.sautikit_virtual_number}
          statusFilter={activeFilter}
          q={q}
        />
      ) : (
        <>
          <ul className="mt-4 space-y-3 lg:hidden">
            {leads.map((lead) => {
              const message = followUpWhatsAppMessage({
                businessName,
                name: lead.name,
                reason: lead.reason,
              });
              return (
                <li
                  key={lead.call.id}
                  className={[
                    "rounded-2xl border bg-surface p-4",
                    lead.urgent ? "border-warn/50 bg-warn-soft" : "border-line",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-ink-soft">
                        {formatCallWhen(lead.call.created_at)}
                      </p>
                      <p className="mt-1 truncate text-base font-medium text-ink">
                        {lead.name || lead.call.caller_number}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">
                        {lead.reason || "No reason yet"}
                      </p>
                      <div className="mt-1.5">
                        <StatusBadges lead={lead} />
                      </div>
                    </div>
                    <WhatsAppLink
                      number={lead.call.caller_number}
                      compact
                      message={message}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    {leadStatusReady ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <LeadStatusToggle
                          callId={lead.call.id}
                          initial={lead.leadStatus}
                        />
                        {lead.leadStatus !== "resolved" ? (
                          <MarkLeadDoneButton callId={lead.call.id} />
                        ) : null}
                      </div>
                    ) : (
                      <span />
                    )}
                    <Link
                      href={`/calls/${lead.call.id}?from=${activeFilter}`}
                      className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-accent hover:border-accent"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-line bg-surface lg:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-muted/70 text-ink-soft">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Caller</th>
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Follow-up</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const message = followUpWhatsAppMessage({
                    businessName,
                    name: lead.name,
                    reason: lead.reason,
                  });
                  return (
                    <tr
                      key={lead.call.id}
                      className={[
                        "border-t border-line/70",
                        lead.urgent ? "bg-warn-soft" : "",
                      ].join(" ")}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatCallWhen(lead.call.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <WhatsAppLink
                          number={lead.call.caller_number}
                          message={message}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium">
                          {lead.name || "—"}
                          <StatusBadges lead={lead} />
                        </div>
                        <div className="line-clamp-1 text-ink-soft">
                          {lead.reason || "No reason yet"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {leadStatusReady ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <LeadStatusToggle
                              callId={lead.call.id}
                              initial={lead.leadStatus}
                            />
                            {lead.leadStatus !== "resolved" ? (
                              <MarkLeadDoneButton callId={lead.call.id} />
                            ) : null}
                          </div>
                        ) : (
                          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs">
                            {lead.call.status || "unknown"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/calls/${lead.call.id}?from=${activeFilter}`}
                          className="font-medium text-accent hover:text-accent-deep"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            href="/calls"
            params={paginationParams}
          />
        </>
      )}
    </div>
  );
}
