import Link from "next/link";
import { getSupabaseAdmin, parseSummary, type CallRow } from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";

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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
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
      </div>
    );
  }

  const calls = (data || []) as CallRow[];

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl tracking-tight text-[var(--ink)]">Calls</h1>
          <p className="mt-2 text-[var(--ink-soft)]">
            Latest missed-call conversations captured by the receptionist.
          </p>
        </div>
        <p className="text-sm text-[var(--ink-soft)]">{calls.length} shown</p>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
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
            {calls.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--ink-soft)]">
                  No calls yet. Place a test call to the SautiKit DID.
                </td>
              </tr>
            ) : (
              calls.map((call) => {
                const meta = parseSummary(call.summary);
                const name = typeof meta.name === "string" ? meta.name : null;
                const reason = typeof meta.reason === "string" ? meta.reason : null;
                const notified = Boolean(meta.whatsapp_sent);
                return (
                  <tr key={call.id} className="border-t border-[var(--line)]/70">
                    <td className="px-4 py-3 whitespace-nowrap">{formatWhen(call.created_at)}</td>
                    <td className="px-4 py-3 font-medium">{call.caller_number}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{name || "—"}</div>
                      <div className="text-[var(--ink-soft)] line-clamp-1">{reason || "No reason yet"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="rounded-full bg-[var(--bg-deep)] px-2.5 py-1 text-xs">
                          {call.status || "unknown"}
                        </span>
                        {notified ? (
                          <span className="text-xs text-[var(--ok)]">alerted</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/calls/${call.id}`}
                        className="text-[var(--accent)] hover:text-[var(--accent-deep)] font-medium"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
