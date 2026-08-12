import Link from "next/link";
import { notFound } from "next/navigation";
import {
  callResolutionLabel,
  parseCallResolution,
  parseLeadStatus,
  parseSummary,
  type CallRow,
  type TranscriptRow,
} from "@/lib/supabase";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { CallAudioPlayer } from "@/components/CallAudioPlayer";
import { CallFaqSuggestions } from "@/components/CallFaqSuggestions";
import { LeadStatusToggle } from "@/components/LeadStatusToggle";
import {
  MarkLeadArchiveButton,
  MarkLeadDoneButton,
} from "@/components/MarkLeadDoneButton";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import {
  callsHref,
  followUpWhatsAppMessage,
  formatCallWhen,
  type StatusFilterId,
} from "@/lib/callsTriage";

/** Allow Gemini FAQ suggest + compile without premature cutoffs. */
export const maxDuration = 60;

/** WhatsApp-style transcript bubble. Caller = green/left, receptionist = grey/right. */
function ChatBubble({ turn }: { turn: TranscriptRow }) {
  const speaker = String(turn.speaker || "").toLowerCase();
  const isCaller = speaker === "caller";
  const isSystem = speaker === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center px-2">
        <p className="max-w-[85%] rounded-full bg-surface-muted/80 px-4 py-1.5 text-center text-xs text-ink-soft">
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
            ? "rounded-bl-md bg-[#d9f4e2] text-ink"
            : "rounded-br-md bg-surface-muted/90 text-ink",
        ].join(" ")}
      >
        <p
          className={[
            "text-[11px] font-medium uppercase tracking-wide",
            isCaller ? "text-[#2f6b3a]" : "text-ink-soft",
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

function parseFromFilter(raw: string | undefined): StatusFilterId | undefined {
  if (
    raw === "all" ||
    raw === "new" ||
    raw === "contacted" ||
    raw === "resolved" ||
    raw === "archived"
  ) {
    return raw;
  }
  return undefined;
}

const CALL_SELECT =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status, resolution, primary_intent, resolution_note";
const CALL_SELECT_LEAD =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment, lead_status";
const CALL_SELECT_LEGACY =
  "id, created_at, tenant_id, caller_number, sautikit_call_sid, status, duration_seconds, recording_url, summary, sentiment";

export default async function CallDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const fromFilter = parseFromFilter(sp.from);
  const backHref = fromFilter ? callsHref({ status: fromFilter }) : "/calls";
  const backLabel =
    fromFilter === "new"
      ? "Back to new leads"
      : fromFilter === "contacted"
        ? "Back to followed up"
        : fromFilter === "resolved"
          ? "Back to done"
          : fromFilter === "archived"
            ? "Back to archived"
            : fromFilter === "all"
              ? "Back to all calls"
              : "Back to inbox";

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

  if (error && /resolution|primary_intent|resolution_note|column/i.test(error.message)) {
    const retry = await workspace.client
      .from("calls")
      .select(CALL_SELECT_LEAD)
      .eq("id", id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    call = retry.data as CallRow | null;
    error = retry.error;
  }

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
  const leadStatus = parseLeadStatus(row.lead_status);
  const resolution = parseCallResolution(row.resolution);
  const title = name || row.caller_number;
  const businessName = tenant.business_name?.trim() || "us";
  const waMessage = followUpWhatsAppMessage({ businessName, name, reason });
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
      <Link
        href={backHref}
        className="text-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        ← {backLabel}
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-ink-soft">{formatCallWhen(row.created_at, "full")}</p>
          {urgent ? (
            <p className="mt-2 text-sm font-medium text-warn">Marked urgent by the receptionist</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WhatsAppLink number={row.caller_number} compact message={waMessage} />
          {leadStatusReady && leadStatus !== "resolved" ? (
            <MarkLeadDoneButton callId={row.id} />
          ) : null}
          {leadStatusReady && leadStatus !== "archived" ? (
            <MarkLeadArchiveButton callId={row.id} />
          ) : null}
        </div>
      </div>

      <section
        className={[
          "mt-6 rounded-2xl border p-5",
          urgent ? "border-warn/50 bg-warn-soft" : "border-accent/30 bg-accent-soft",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xs uppercase tracking-wide text-ink-soft">
              What this call was about
            </h2>
            <p className="mt-2 text-base leading-relaxed text-ink">
              {buildSummarySentence({
                name,
                reason,
                callerNumber: row.caller_number,
                urgent,
              })}
            </p>
          </div>
          {leadStatusReady ? (
            <LeadStatusToggle callId={row.id} initial={leadStatus} size="md" />
          ) : null}
        </div>
        <p className="mt-4 text-xs text-ink-soft">
          Tip: WhatsApp opens with a short follow-up draft. Use{" "}
          <span className="font-medium text-ink">Done</span> when finished, or{" "}
          <span className="font-medium text-ink">Archive</span> to hide from the
          active inbox (not a hard delete).
        </p>
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-xs uppercase tracking-wide text-ink-soft">Caller</h2>
          <div className="mt-2 text-lg">
            <WhatsAppLink number={row.caller_number} message={waMessage} />
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            SID {row.sautikit_call_sid || "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-xs uppercase tracking-wide text-ink-soft">Call</h2>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <span>Duration: {row.duration_seconds ?? "—"}s</span>
            <span>Alert sent: {meta.whatsapp_sent ? "yes" : "no"}</span>
            <span>Escalation: {meta.escalation_sent ? "sent" : "no"}</span>
          </div>
          {row.resolution != null || row.primary_intent || row.resolution_note ? (
            <div className="mt-2 space-y-1 text-sm">
              <p>
                Assist:{" "}
                <span className="font-medium text-ink">
                  {callResolutionLabel(resolution)}
                </span>
                {row.primary_intent ? (
                  <span className="text-ink-soft"> · {row.primary_intent}</span>
                ) : null}
              </p>
              {row.resolution_note ? (
                <p className="text-ink-soft">{row.resolution_note}</p>
              ) : null}
            </div>
          ) : null}
          {escalatedTo?.name ? (
            <p className="mt-2 text-sm text-ink">
              Escalated to {escalatedTo.name}
              {escalatedTo.role ? ` (${escalatedTo.role})` : ""}
              {escalateReason ? `: ${escalateReason}` : ""}
            </p>
          ) : null}
          {!row.recording_url ? (
            <p className="mt-2 text-sm text-ink-soft">No recording attached yet.</p>
          ) : null}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Conversation</h2>
        <div className="mt-4 rounded-2xl border border-line bg-surface px-2 py-4 sm:px-4">
          {turns.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-soft">
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
