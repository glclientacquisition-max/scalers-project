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

function isTodayNairobi(iso: string): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Nairobi",
      dateStyle: "short",
    });
    return fmt.format(new Date(iso)) === fmt.format(new Date());
  } catch {
    return false;
  }
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
        warn ? "border-[var(--warn)]/50 bg-[#fdf3ec]" : "border-[var(--line)] bg-[var(--card)]",
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

function KpiStrip({ tenant, leads }: { tenant: TenantRow; leads: Lead[] }) {
  const missedToday = leads.filter((l) => isTodayNairobi(l.call.created_at)).length;
  const captured = leads.filter((l) => l.name || l.reason).length;
  const needFollowUp = leads.filter((l) => l.leadStatus === "new").length;

  const kes = Number(tenant.telecom_wallet_balance_kes ?? 0);
  const usd = Number(tenant.ai_wallet_balance_usd ?? 0);
  const lowWallet = kes < 200 || usd < 1;

  return (
    <section className="mt-8 grid gap-3 sm:grid-cols-3">
      <Kpi
        label="Today's missed calls"
        value={missedToday}
        hint={needFollowUp > 0 ? `${needFollowUp} waiting for follow-up` : "All followed up"}
        warn={needFollowUp > 0}
      />
      <Kpi label="Leads captured" value={captured} hint="Callers with a name or reason" />
      <Kpi
        label="Wallet"
        value={`KES ${kes.toLocaleString("en-KE")}`}
        hint={lowWallet ? "Low balance — top up soon" : `AI usage: $${usd.toFixed(2)}`}
        warn={lowWallet}
      />
    </section>
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

export default async function CallsPage() {
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

  // Owner: JWT + RLS. Legacy Super Admin desk: service role (bypasses RLS).
  let leadStatusReady = true;
  const first = await workspace.client
    .from("calls")
    .select(CALL_SELECT)
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(50);
  let data = first.data as CallRow[] | null;
  let error = first.error;

  if (error && /lead_status|column/i.test(error.message)) {
    // lead_status.sql not applied yet — degrade gracefully without toggles.
    leadStatusReady = false;
    const retry = await workspace.client
      .from("calls")
      .select(CALL_SELECT_LEGACY)
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(50);
    data = retry.data as CallRow[] | null;
    error = retry.error;
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

  const leads = (data || []).map(toLead);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl tracking-tight text-[var(--ink)]">Calls</h1>
          <p className="mt-2 text-[var(--ink-soft)]">
            Triage missed-call leads and follow up while they are hot.
          </p>
        </div>
        <p className="text-sm text-[var(--ink-soft)]">{leads.length} shown</p>
      </div>

      <KpiStrip tenant={tenant} leads={leads} />

      {!leadStatusReady ? (
        <p className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-xs text-[var(--ink-soft)]">
          Lead statuses (New / Contacted / Resolved) need a one-time database update — apply{" "}
          <code>docs/supabase/lead_status.sql</code> in Supabase.
        </p>
      ) : null}

      {leads.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-4 py-10 text-center text-[var(--ink-soft)]">
          No calls yet. Place a test call to the SautiKit DID.
        </div>
      ) : (
        <>
          {/* Mobile (< md): stacked Lead Cards */}
          <ul className="mt-6 space-y-3 md:hidden">
            {leads.map((lead) => (
              <li
                key={lead.call.id}
                className={[
                  "rounded-2xl border bg-[var(--card)] p-4",
                  lead.urgent ? "border-[var(--warn)]/50 bg-[#fdf3ec]" : "border-[var(--line)]",
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

          {/* Desktop (md+): classic table */}
          <div className="mt-6 hidden overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
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
                      lead.urgent ? "bg-[#fdf3ec]" : "",
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
                        className="text-[var(--accent)] hover:text-[var(--accent-deep)] font-medium"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
