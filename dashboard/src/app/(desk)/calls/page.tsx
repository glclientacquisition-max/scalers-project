import Link from "next/link";
import { parseSummary, type CallRow } from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
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

type Lead = {
  call: CallRow;
  name: string | null;
  reason: string | null;
  notified: boolean;
  urgent: boolean;
};

function toLead(call: CallRow): Lead {
  const meta = parseSummary(call.summary);
  return {
    call,
    name: typeof meta.name === "string" ? meta.name : null,
    reason: typeof meta.reason === "string" ? meta.reason : null,
    notified: Boolean(meta.whatsapp_sent),
    urgent: String(call.sentiment || "").toLowerCase() === "urgent",
  };
}

function StatusBadge({ lead }: { lead: Lead }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="rounded-full bg-[var(--bg-deep)] px-2.5 py-1 text-xs">
        {lead.call.status || "unknown"}
      </span>
      {lead.notified ? <span className="text-xs text-[var(--ok)]">alerted</span> : null}
      {lead.urgent ? (
        <span className="rounded-full bg-[var(--warn)]/10 px-2 py-0.5 text-xs font-medium text-[var(--warn)]">
          urgent
        </span>
      ) : null}
    </span>
  );
}

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
  const { data, error } = await workspace.client
    .from("calls")
    .select(
      "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment"
    )
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(50);

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

  const leads = ((data || []) as CallRow[]).map(toLead);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl tracking-tight text-[var(--ink)]">Calls</h1>
          <p className="mt-2 text-[var(--ink-soft)]">
            Latest missed-call conversations captured by the receptionist.
          </p>
        </div>
        <p className="text-sm text-[var(--ink-soft)]">{leads.length} shown</p>
      </div>

      {leads.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-4 py-10 text-center text-[var(--ink-soft)]">
          No calls yet. Place a test call to the SautiKit DID.
        </div>
      ) : (
        <>
          {/* Mobile (< md): stacked Lead Cards */}
          <ul className="mt-8 space-y-3 md:hidden">
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
                  </div>
                  <WhatsAppLink number={lead.call.caller_number} compact />
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <StatusBadge lead={lead} />
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
          <div className="mt-8 hidden overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--bg-deep)]/70 text-[var(--ink-soft)]">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Caller</th>
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Status</th>
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
                      <div className="font-medium">{lead.name || "—"}</div>
                      <div className="text-[var(--ink-soft)] line-clamp-1">
                        {lead.reason || "No reason yet"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge lead={lead} />
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
