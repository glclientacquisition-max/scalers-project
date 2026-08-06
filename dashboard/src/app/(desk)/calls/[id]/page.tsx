import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSupabaseAdmin,
  parseSummary,
  type CallRow,
  type TranscriptRow,
} from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      dateStyle: "full",
      timeStyle: "medium",
      timeZone: "Africa/Nairobi",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  if (!tenant) notFound();

  const supabase = getSupabaseAdmin();

  const { data: call, error } = await supabase
    .from("calls")
    .select(
      "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment"
    )
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (error || !call) notFound();
  const row = call as CallRow;
  const meta = parseSummary(row.summary);

  const { data: transcripts } = await supabase
    .from("transcripts")
    .select("id, created_at, call_id, speaker, text_content, latency_ms")
    .eq("call_id", id)
    .order("created_at", { ascending: true });

  const turns = (transcripts || []) as TranscriptRow[];

  return (
    <div className="max-w-3xl">
      <Link href="/calls" className="text-sm text-[var(--accent)] hover:underline">
        ← All calls
      </Link>

      <h1 className="mt-4 font-display text-4xl tracking-tight">Call detail</h1>
      <p className="mt-2 text-[var(--ink-soft)]">{formatWhen(row.created_at)}</p>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <h2 className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Caller</h2>
          <p className="mt-2 text-lg font-medium">{row.caller_number}</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            SID {row.sautikit_call_sid || "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <h2 className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Lead</h2>
          <p className="mt-2 text-lg font-medium">
            {typeof meta.name === "string" ? meta.name : "—"}
          </p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            {typeof meta.reason === "string" ? meta.reason : "No reason saved"}
          </p>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <h2 className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Status</h2>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <span>Status: {row.status || "—"}</span>
          <span>Duration: {row.duration_seconds ?? "—"}s</span>
          <span>Alert sent: {meta.whatsapp_sent ? "yes" : "no"}</span>
        </div>
        {row.recording_url ? (
          <p className="mt-3 text-sm">
            Recording:{" "}
            <a
              className="text-[var(--accent)] underline break-all"
              href={row.recording_url}
              target="_blank"
              rel="noreferrer"
            >
              open link
            </a>
          </p>
        ) : (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">No recording attached yet.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Transcript</h2>
        <div className="mt-4 space-y-3">
          {turns.length === 0 ? (
            <p className="text-[var(--ink-soft)] text-sm">No transcript rows for this call.</p>
          ) : (
            turns.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3"
              >
                <div className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">
                  {t.speaker}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{t.text_content}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
