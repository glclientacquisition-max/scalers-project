import Link from "next/link";
import { notFound } from "next/navigation";
import {
  parseLeadStatus,
  parseSummary,
  type CallRow,
  type TranscriptRow,
} from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { CallAudioPlayer } from "@/components/CallAudioPlayer";
import { CallFaqSuggestions } from "@/components/CallFaqSuggestions";
import { LeadStatusToggle } from "@/components/LeadStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";

/** Allow Gemini FAQ suggest + compile without premature cutoffs. */
export const maxDuration = 60;

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

/** WhatsApp-style transcript bubble. Caller = green/left, receptionist = grey/right. */
function ChatBubble({ turn }: { turn: TranscriptRow }) {
  const speaker = String(turn.speaker || "").toLowerCase();
  const isCaller = speaker === "caller";
  const isSystem = speaker === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center px-2">
        <p className="max-w-[85%] rounded-full bg-[var(--bg-deep)]/80 px-4 py-1.5 text-center text-xs text-[var(--ink-soft)]">
          {turn.text_content}
        </p>
      </div>
    );
  }

  return (
    <div className={["flex px-1", isCaller ? "justify-start" : "justify-end"].join(" ")}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[75%]",
          isCaller
            ? "rounded-bl-md bg-[#d9f4e2] text-[var(--ink)]"
            : "rounded-br-md bg-[var(--bg-deep)]/90 text-[var(--ink)]",
        ].join(" ")}
      >
        <p
          className={[
            "text-[11px] font-medium uppercase tracking-wide",
            isCaller ? "text-[#2f6b3a]" : "text-[var(--ink-soft)]",
          ].join(" ")}
        >
          {isCaller ? "Caller" : "Receptionist"}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{turn.text_content}</p>
      </div>
    </div>
  );
}

function buildSummarySentence(opts: {
  name: string | null;
  reason: string | null;
  callerNumber: string;
  urgent: boolean;
}): string {
  const who = opts.name || `The caller (${opts.callerNumber})`;
  if (!opts.reason) {
    return `${who} called, but no reason was captured yet. Skim the conversation below.`;
  }
  const reason = opts.reason.replace(/\.$/, "");
  return `${who} called about: ${reason}.${opts.urgent ? " This sounded urgent." : ""}`;
}

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";
const CALL_SELECT_LEGACY =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  if (!tenant) notFound();

  const workspace = await createWorkspaceDataClient();
  if (!workspace) notFound();

  let leadStatusReady = true;
  const first = await workspace.client
    .from("calls")
    .select(CALL_SELECT)
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  let call = first.data as CallRow | null;
  let error = first.error;

  if (error && /lead_status|column/i.test(error.message)) {
    leadStatusReady = false;
    const retry = await workspace.client
      .from("calls")
      .select(CALL_SELECT_LEGACY)
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    call = retry.data as CallRow | null;
    error = retry.error;
  }

  if (error || !call) notFound();
  const row = call;
  const meta = parseSummary(row.summary);
  const name = typeof meta.name === "string" ? meta.name : null;
  const reason = typeof meta.reason === "string" ? meta.reason : null;
  const urgent = String(row.sentiment || "").toLowerCase() === "urgent";
  const escalatedTo =
    meta.escalated_to && typeof meta.escalated_to === "object"
      ? (meta.escalated_to as { name?: string; role?: string; phone?: string })
      : null;
  const escalateReason =
    typeof meta.escalate_reason === "string" ? meta.escalate_reason : null;

  const { data: transcripts } = await workspace.client
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

      {/* AI summary box — the 3-second read */}
      <section
        className={[
          "mt-6 rounded-2xl border p-5",
          urgent
            ? "border-warn/50 bg-warn-soft"
            : "border-accent/30 bg-accent-soft",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">
              What this call was about
            </h2>
            <p className="mt-2 text-base leading-relaxed text-[var(--ink)]">
              {buildSummarySentence({ name, reason, callerNumber: row.caller_number, urgent })}
            </p>
          </div>
          {leadStatusReady ? (
            <LeadStatusToggle
              callId={row.id}
              initial={parseLeadStatus(row.lead_status)}
              size="md"
            />
          ) : null}
        </div>
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <h2 className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Caller</h2>
          <div className="mt-2 text-lg">
            <WhatsAppLink number={row.caller_number} />
          </div>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            SID {row.sautikit_call_sid || "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <h2 className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Call</h2>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <span>Duration: {row.duration_seconds ?? "—"}s</span>
            <span>Alert sent: {meta.whatsapp_sent ? "yes" : "no"}</span>
            <span>Escalation: {meta.escalation_sent ? "sent" : "no"}</span>
          </div>
          {escalatedTo?.name ? (
            <p className="mt-2 text-sm text-[var(--ink)]">
              Escalated to {escalatedTo.name}
              {escalatedTo.role ? ` (${escalatedTo.role})` : ""}
              {escalateReason ? ` — ${escalateReason}` : ""}
            </p>
          ) : null}
          {!row.recording_url ? (
            <p className="mt-2 text-sm text-[var(--ink-soft)]">No recording attached yet.</p>
          ) : null}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Conversation</h2>
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-2 py-4 sm:px-4">
          {turns.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--ink-soft)]">
              No transcript rows for this call.
            </p>
          ) : (
            <div className="space-y-2.5">
              {turns.map((t) => (
                <ChatBubble key={t.id} turn={t} />
              ))}
            </div>
          )}
        </div>
      </section>

      <CallFaqSuggestions
        tenantId={tenant.id}
        callId={row.id}
        hasTranscript={turns.length > 0}
      />

      {row.recording_url ? <CallAudioPlayer src={row.recording_url} /> : null}
    </div>
  );
}
