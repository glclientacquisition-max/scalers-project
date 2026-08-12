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
import { waMeHref } from "@/components/WhatsAppLink";
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
    return `${who} called, but no reason was captured yet. Skim the conversation.`;
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

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.33 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.73 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.83 9.83 0 0 0 12.04 2Zm0 18.13h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
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
  const waHref = waMeHref(row.caller_number, waMessage);
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
    <div className="max-w-6xl">
      <Link
        href={backHref}
        className="text-sm font-medium text-[#0096FF] hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        ← {backLabel}
      </Link>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        {/* LEFT PANE: sticky context + primary CTA */}
        <aside className="space-y-5 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <div>
            <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
              {title}
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              {formatCallWhen(row.created_at, "full")}
            </p>
            <p className="mt-1 font-mono text-sm text-ink">{row.caller_number}</p>
            {urgent ? (
              <p className="mt-2 text-sm font-medium text-warn">Urgent</p>
            ) : null}
          </div>

          <section
            className={[
              "rounded-2xl border p-5",
              urgent ? "border-warn/45 bg-warn-soft/50" : "border-line bg-surface",
            ].join(" ")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                What this call was about
              </h2>
              {leadStatusReady ? (
                <LeadStatusToggle callId={row.id} initial={leadStatus} size="md" />
              ) : null}
            </div>
            <p className="mt-3 text-base leading-relaxed text-ink">
              {buildSummarySentence({
                name,
                reason,
                callerNumber: row.caller_number,
                urgent,
              })}
            </p>
          </section>

          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[3.5rem] w-full items-center justify-center gap-2.5 rounded-xl bg-[#25D366] px-4 py-4 text-base font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
            >
              <WhatsAppGlyph className="h-5 w-5 shrink-0" />
              Reply on WhatsApp
            </a>
          ) : null}

          {leadStatusReady ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line/80 pt-4">
              {leadStatus !== "resolved" ? (
                <MarkLeadDoneButton callId={row.id} />
              ) : null}
              {leadStatus !== "archived" ? (
                <MarkLeadArchiveButton callId={row.id} />
              ) : null}
            </div>
          ) : null}

          <div className="space-y-4 border-t border-line/80 pt-5">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                Caller
              </h2>
              <p className="mt-2 text-lg font-medium text-ink">{row.caller_number}</p>
              {name ? (
                <p className="mt-1 text-sm text-ink-soft">Name: {name}</p>
              ) : null}
              <p className="mt-2 text-xs text-ink-soft">
                SID {row.sautikit_call_sid || "Not set"}
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                Call
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
                <span>
                  Duration:{" "}
                  {row.duration_seconds != null ? `${row.duration_seconds}s` : "N/A"}
                </span>
                <span>Alert sent: {meta.whatsapp_sent ? "yes" : "no"}</span>
                <span>Escalation: {meta.escalation_sent ? "sent" : "no"}</span>
              </div>
              {row.resolution != null || row.primary_intent || row.resolution_note ? (
                <div className="mt-3 space-y-1 text-sm">
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
                <p className="mt-3 text-sm text-ink">
                  Escalated to {escalatedTo.name}
                  {escalatedTo.role ? ` (${escalatedTo.role})` : ""}
                  {escalateReason ? `: ${escalateReason}` : ""}
                </p>
              ) : null}
              {!row.recording_url ? (
                <p className="mt-3 text-sm text-ink-soft">No recording attached yet.</p>
              ) : null}
            </div>
          </div>

          {row.recording_url ? (
            <CallAudioPlayer src={row.recording_url} />
          ) : null}
        </aside>

        {/* RIGHT PANE: transcript + FAQ ideas */}
        <div className="min-h-0 space-y-8 lg:col-span-8 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
          <section>
            <h2 className="font-display text-2xl tracking-tight text-ink">
              Conversation
            </h2>
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
        </div>
      </div>
    </div>
  );
}
