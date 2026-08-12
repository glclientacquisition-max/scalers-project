import Link from "next/link";
import {
  type CallRow,
  type LeadStatus,
} from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { CallsToolbar } from "@/components/CallsCommandCenter";
import { LeadStatusToggle } from "@/components/LeadStatusToggle";
import {
  MarkLeadArchiveButton,
  MarkLeadDoneButton,
} from "@/components/MarkLeadDoneButton";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import {
  callsHref,
  followUpWhatsAppMessage,
  formatCallWhen,
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
          className="mt-5 inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-[#005ccc] transition hover:border-[#0096FF] focus-visible:outline-none focus-visible:shadow-focus"
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
          ? "followed-up leads"
          : statusFilter === "resolved"
            ? "done leads"
            : "archived leads";
    return (
      <div className="mt-6 border-y border-line py-10 text-center">
        <p className="font-display text-xl tracking-tight text-ink">No {label}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          Nothing in this follow-up bucket right now.
        </p>
        <Link
          href={callsHref({ status: "all" })}
          className="mt-5 inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-[#005ccc] transition hover:border-[#0096FF] focus-visible:outline-none focus-visible:shadow-focus"
        >
          Show all calls
        </Link>
      </div>
    );
  }

  if (pendingDid) {
    return (
      <div className="mt-6 border-y border-[#0096FF]/30 bg-[#0096FF]/5 py-10 text-center">
        <p className="font-display text-xl tracking-tight text-ink">Number being assigned</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          Train the business profile now. Once the number is live, test calls land here.
        </p>
        <Link
          href="/settings#train"
          className="mt-5 inline-flex rounded-xl bg-[#0096FF] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:shadow-focus"
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
          className="font-medium text-[#005ccc] underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {did}
        </a>{" "}
        from another phone.
      </p>
      <Link
        href="/settings#test"
        className="mt-5 inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-[#005ccc] transition hover:border-[#0096FF] focus-visible:outline-none focus-visible:shadow-focus"
      >
        How to test
      </Link>
    </div>
  );
}

function StatusBadges({ lead }: { lead: Lead }) {
  const showResolution =
    lead.resolution && lead.resolution !== "unknown";
  return (
    <span className="inline-flex items-center gap-2">
      {lead.notified ? <span className="text-xs text-ok">alerted</span> : null}
      {lead.urgent ? (
        <span className="text-xs font-medium text-warn">urgent</span>
      ) : null}
      {showResolution ? (
        <span className="text-xs text-ink-soft">
          {lead.resolution === "needs_human"
            ? "needs human"
            : lead.resolution}
        </span>
      ) : null}
    </span>
  );
}

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status, resolution, primary_intent, resolution_note";
const CALL_SELECT_LEGACY =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment";
const CALL_SELECT_LEAD =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

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

  let leadStatusReady = true;
  const client = workspace.client;
  const businessName = tenant.business_name?.trim() || "us";

  const statusCountQuery = (status: LeadStatus) =>
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("lead_status", status);

  const [allRes, newRes, contactedRes, resolvedRes, archivedRes] =
    await Promise.all([
      client
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .neq("lead_status", "archived"),
      statusCountQuery("new"),
      statusCountQuery("contacted"),
      statusCountQuery("resolved"),
      statusCountQuery("archived"),
    ]);

  if (newRes.error && /lead_status|column/i.test(newRes.error.message)) {
    leadStatusReady = false;
  }
  const archiveReady = !(
    archivedRes.error && /lead_status|archived|check|column/i.test(archivedRes.error.message)
  );

  const newCount = leadStatusReady ? newRes.count ?? 0 : 0;
  const statusCounts = {
    all: leadStatusReady ? allRes.count ?? 0 : 0,
    new: newCount,
    contacted: leadStatusReady ? contactedRes.count ?? 0 : 0,
    resolved: leadStatusReady ? resolvedRes.count ?? 0 : 0,
    archived: archiveReady ? archivedRes.count ?? 0 : 0,
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
  } else if (leadStatusReady) {
    listQuery = listQuery.neq("lead_status", "archived");
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

  if (error && /resolution|primary_intent|resolution_note|column/i.test(error.message)) {
    let retryQuery = client
      .from("calls")
      .select(CALL_SELECT_LEAD, { count: "exact" })
      .eq("tenant_id", tenant.id);
    if (leadStatusReady && activeFilter !== "all") {
      retryQuery = retryQuery.eq("lead_status", activeFilter);
    } else if (leadStatusReady) {
      retryQuery = retryQuery.neq("lead_status", "archived");
    }
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

  const leads = (data || []).map(toLead);
  const paginationParams: Record<string, string | undefined> = {
    status: activeFilter,
    q: q || undefined,
  };

  return (
    <div>
      {!leadStatusReady ? (
        <p className="mb-6 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-ink-soft">
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
          <ul className="mt-6 space-y-3 md:hidden">
            {leads.map((lead) => {
              const message = followUpWhatsAppMessage({
                businessName,
                name: lead.name,
                reason: lead.reason,
              });
              return (
                <li
                  key={`m-${lead.call.id}`}
                  className={[
                    "min-w-0 rounded-2xl border border-line bg-surface p-4",
                    lead.urgent ? "border-warn/40 bg-warn-soft/40" : "",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-ink-soft">{formatCallWhen(lead.call.created_at)}</p>
                      <p className="mt-1 font-medium text-ink [overflow-wrap:anywhere]">
                        {lead.name || "Unknown"}
                      </p>
                      <div className="mt-1"><StatusBadges lead={lead} /></div>
                    </div>
                    <Link
                      href={`/calls/${lead.call.id}?from=${activeFilter}`}
                      className="inline-flex min-h-11 items-center font-medium text-[#0096FF] hover:text-[#005ccc]"
                    >
                      Open
                    </Link>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft [overflow-wrap:anywhere]">
                    {lead.reason || "No reason yet"}
                  </p>
                  <div className="mt-3 min-w-0">
                    <WhatsAppLink number={lead.call.caller_number} message={message} />
                  </div>
                  {leadStatusReady ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <LeadStatusToggle callId={lead.call.id} initial={lead.leadStatus} />
                      {lead.leadStatus !== "resolved" ? (
                        <MarkLeadDoneButton callId={lead.call.id} />
                      ) : null}
                      {lead.leadStatus !== "archived" ? (
                        <MarkLeadArchiveButton callId={lead.call.id} />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line bg-surface-muted/70 text-ink-soft">
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
                        "border-t border-line/70 transition hover:bg-surface-muted/30",
                        lead.urgent ? "bg-warn-soft/60" : "",
                      ].join(" ")}
                    >
                      <td className="whitespace-nowrap px-4 py-3.5 text-ink-soft">
                        {formatCallWhen(lead.call.created_at)}
                      </td>
                      <td className="px-4 py-3.5">
                        <WhatsAppLink
                          number={lead.call.caller_number}
                          message={message}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2 font-medium text-ink">
                          {lead.name || "Unknown"}
                          <StatusBadges lead={lead} />
                        </div>
                        <div className="mt-0.5 line-clamp-1 text-ink-soft">
                          {lead.reason || "No reason yet"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {leadStatusReady ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <LeadStatusToggle
                              callId={lead.call.id}
                              initial={lead.leadStatus}
                            />
                            {lead.leadStatus !== "resolved" ? (
                              <MarkLeadDoneButton callId={lead.call.id} />
                            ) : null}
                            {lead.leadStatus !== "archived" ? (
                              <MarkLeadArchiveButton callId={lead.call.id} />
                            ) : null}
                          </div>
                        ) : (
                          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs">
                            {lead.call.status || "unknown"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/calls/${lead.call.id}?from=${activeFilter}`}
                          className="font-medium text-[#0096FF] hover:text-[#005ccc]"
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
