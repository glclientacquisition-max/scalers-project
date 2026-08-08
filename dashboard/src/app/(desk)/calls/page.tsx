import Link from "next/link";
import {
  parseLeadStatus,
  parseSummary,
  type CallRow,
  type LeadStatus,
  type TenantRow,
} from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { LeadStatusToggle } from "@/components/LeadStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function nairobiDayStartIso(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(new Date()); // YYYY-MM-DD
  return new Date(`${day}T00:00:00+03:00`).toISOString();
}

type Lead = {
  call: CallRow;
  name: string | null;
  reason: string | null;
  notified: boolean;
  urgent: boolean;
  leadStatus: LeadStatus;
};

function toLead(call: CallRow): Lead {
  const meta = parseSummary(call.summary);
  return {
    call,
    name: typeof meta.name === "string" ? meta.name : null,
    reason: typeof meta.reason === "string" ? meta.reason : null,
    notified: Boolean(meta.whatsapp_sent),
    urgent: String(call.sentiment || "").toLowerCase() === "urgent",
    leadStatus: parseLeadStatus(call.lead_status),
  };
}

function Kpi({
  label,
  value,
  hint,
  warn = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border px-5 py-4",
        warn ? "border-warn/50 bg-warn-soft" : "border-line bg-surface",
      ].join(" ")}
    >
      <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">{label}</p>
      <p
        className={[
          "mt-2 font-display text-3xl tracking-tight",
          warn ? "text-[var(--warn)]" : "text-[var(--ink)]",
        ].join(" ")}
      >
        {value}
      </p>
      {hint ? (
        <p className={["mt-1 text-xs", warn ? "text-[var(--warn)]" : "text-[var(--ink-soft)]"].join(" ")}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function KpiStrip({
  tenant,
  todayCount,
  newCount,
  capturedOnPage,
}: {
  tenant: TenantRow;
  todayCount: number;
  newCount: number;
  capturedOnPage: number;
}) {
  const kes = Number(
    tenant.wallet_balance_kes ??
      (Number(tenant.telecom_wallet_balance_kes ?? 0) +
        Math.round(Number(tenant.ai_wallet_balance_usd ?? 0) * 130))
  );
  const lowWallet = kes < 200;

  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-3">
      <Kpi
        label="Today's calls"
        value={todayCount}
        hint={newCount > 0 ? `${newCount} waiting for follow-up` : "All followed up"}
        warn={newCount > 0}
      />
      <Kpi label="Leads shown" value={capturedOnPage} hint="Name or reason on this page" />
      <Link href="/wallet" className="block rounded-2xl focus-visible:outline-none focus-visible:shadow-focus">
        <Kpi
          label="Wallet"
          value={`KES ${kes.toLocaleString("en-KE")}`}
          hint={lowWallet ? "Low balance. Top up soon." : "Prepaid KES balance"}
          warn={lowWallet}
        />
      </Link>
    </section>
  );
}

function EmptyCalls({
  total,
  pendingDid,
  did,
}: {
  total: number;
  pendingDid: boolean;
  did: string;
}) {
  if (total > 0) {
    return (
      <div className="mt-6 rounded-2xl border border-line bg-surface px-4 py-10 text-center text-ink-soft">
        No calls on this page.
      </div>
    );
  }

  if (pendingDid) {
    return (
      <div className="mt-6 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-10 text-center">
        <p className="font-display text-xl tracking-tight text-ink">Number being assigned</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          Your assistant line is almost ready. Train the business profile now. Once the number is live, place a test call and leads will show up here.
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
    <div className="mt-6 rounded-2xl border border-line bg-surface px-4 py-10 text-center text-ink-soft">
      <p className="font-display text-xl tracking-tight text-ink">No calls yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm">
        Place a test call to{" "}
        <a
          href={`tel:${did}`}
          className="font-medium text-accent-deep underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {did}
        </a>{" "}
        from another phone. Captured leads will land here for triage.
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
      {lead.notified ? <span className="text-xs text-[var(--ok)]">alerted</span> : null}
      {lead.urgent ? (
        <span className="rounded-full bg-[var(--warn)]/10 px-2 py-0.5 text-xs font-medium text-[var(--warn)]">
          urgent
        </span>
      ) : null}
    </span>
  );
}

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";
const CALL_SELECT_LEGACY =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

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

  let leadStatusReady = true;
  const dayStart = nairobiDayStartIso();
  const client = workspace.client;

  let first = await client
    .from("calls")
    .select(CALL_SELECT, { count: "exact" })
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  let data = first.data as CallRow[] | null;
  let error = first.error;
  let total = first.count ?? 0;

  if (error && /lead_status|column/i.test(error.message)) {
    leadStatusReady = false;
    const retry = await client
      .from("calls")
      .select(CALL_SELECT_LEGACY, { count: "exact" })
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .range(from, to);
    data = retry.data as CallRow[] | null;
    error = retry.error;
    total = retry.count ?? 0;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--warn)]/40 bg-white p-6 text-[var(--warn)]">
        Could not load calls: {error.message}
        {/row-level security|permission denied|rls/i.test(error.message) ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Apply docs/supabase/owner_rls.sql in Supabase if you have not yet.
          </p>
        ) : null}
      </div>
    );
  }

  const [todayRes, newRes] = await Promise.all([
    client
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("created_at", dayStart),
    leadStatusReady
      ? client
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("lead_status", "new")
      : Promise.resolve({ count: 0, error: null }),
  ]);

  const leads = (data || []).map(toLead);
  const capturedOnPage = leads.filter((l) => l.name || l.reason).length;
  const todayCount = todayRes.count ?? 0;
  const newCount = newRes.count ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-[var(--ink)] sm:text-4xl">
            Calls
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)] sm:text-base">
            Triage leads and follow up while they are hot.
          </p>
        </div>
      </div>

      <KpiStrip
        tenant={tenant}
        todayCount={todayCount}
        newCount={newCount}
        capturedOnPage={capturedOnPage}
      />

      {!leadStatusReady ? (
        <p className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-xs text-[var(--ink-soft)]">
          Lead statuses need a one-time database update. Apply{" "}
          <code>docs/supabase/lead_status.sql</code> in Supabase.
        </p>
      ) : null}

      {leads.length === 0 ? (
        <EmptyCalls
          total={total}
          pendingDid={String(tenant.sautikit_virtual_number || "").startsWith("pending:")}
          did={tenant.sautikit_virtual_number}
        />
      ) : (
        <>
          {/* Mobile + tablet: cards. Desktop lg+: table */}
          <ul className="mt-6 space-y-3 lg:hidden">
            {leads.map((lead) => (
              <li
                key={lead.call.id}
                className={[
                  "rounded-2xl border bg-[var(--card)] p-4",
                  lead.urgent ? "border-warn/50 bg-warn-soft" : "border-line",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--ink-soft)]">
                      {formatWhen(lead.call.created_at)}
                    </p>
                    <p className="mt-1 truncate text-base font-medium text-[var(--ink)]">
                      {lead.name || lead.call.caller_number}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--ink-soft)] line-clamp-2">
                      {lead.reason || "No reason yet"}
                    </p>
                    <div className="mt-1.5">
                      <StatusBadges lead={lead} />
                    </div>
                  </div>
                  <WhatsAppLink number={lead.call.caller_number} compact />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  {leadStatusReady ? (
                    <LeadStatusToggle callId={lead.call.id} initial={lead.leadStatus} />
                  ) : (
                    <span />
                  )}
                  <Link
                    href={`/calls/${lead.call.id}`}
                    className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:border-[var(--accent)]"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] lg:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[var(--bg-deep)]/70 text-[var(--ink-soft)]">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Caller</th>
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Follow-up</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.call.id}
                    className={[
                      "border-t border-[var(--line)]/70",
                      lead.urgent ? "bg-warn-soft" : "",
                    ].join(" ")}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatWhen(lead.call.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <WhatsAppLink number={lead.call.caller_number} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        {lead.name || "—"}
                        <StatusBadges lead={lead} />
                      </div>
                      <div className="text-[var(--ink-soft)] line-clamp-1">
                        {lead.reason || "No reason yet"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {leadStatusReady ? (
                        <LeadStatusToggle callId={lead.call.id} initial={lead.leadStatus} />
                      ) : (
                        <span className="rounded-full bg-[var(--bg-deep)] px-2.5 py-1 text-xs">
                          {lead.call.status || "unknown"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/calls/${lead.call.id}`}
                        className="font-medium text-[var(--accent)] hover:text-[var(--accent-deep)]"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} pageSize={PAGE_SIZE} total={total} href="/calls" />
        </>
      )}
    </div>
  );
}
