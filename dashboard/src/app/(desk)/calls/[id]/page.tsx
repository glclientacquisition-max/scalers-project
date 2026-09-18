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
import { pickCallOwnerCard, pickCallOwnerReason, pickCallOwnerWant } from "@/lib/callSummarySentence";
import { CallSummaryCard } from "@/components/CallSummaryCard";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { CallRecording } from "@/components/CallRecording";
import { CallFaqSuggestions } from "@/components/CallFaqSuggestions";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { LeadStatusToggle } from "@/components/LeadStatusToggle";
import {
  MarkLeadArchiveButton,
  MarkLeadDoneButton,
} from "@/components/MarkLeadDoneButton";
import { InboxJobEditor } from "@/components/InboxJobEditor";
import { InboxHoldEditor } from "@/components/InboxHoldEditor";
import { InboxJobActions } from "@/components/InboxJobActions";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { CallerNoteComposer } from "@/components/CallerNoteComposer";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { pageTitleClass } from "@/components/ui/deskChrome";
import { DeskBack } from "@/components/ui/DeskBack";
import { DeskError } from "@/components/ui/DeskError";
import { parseNotifyChannels } from "@/lib/notifyChannels";
import {
  followUpWhatsAppMessage,
  formatCallWhen,
} from "@/lib/callsTriage";
import {
  contactFromCallHref,
  inboxReturnFromSearch,
  inboxReturnHref,
} from "@/lib/inboxHref";
import {
  classifyInboxPurpose,
  signalLabel,
  type InboxHold,
  type InboxJob,
} from "@/lib/inboxPurpose";

/** Allow Gemini FAQ suggest + compile without premature cutoffs. */
export const maxDuration = 60;

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
            ? "rounded-bl-md bg-bubble-caller text-ink"
            : "rounded-br-md bg-surface-muted/90 text-ink",
        ].join(" ")}
      >
        <p
          className={[
            "text-[11px] font-medium uppercase tracking-wide",
            isCaller ? "text-bubble-caller-ink" : "text-ink-soft",
          ].join(" ")}
        >
          {isCaller ? "Caller" : "Receptionist"}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{turn.text_content}</p>
      </div>
    </div>
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
  searchParams: Promise<{
    from?: string;
    view?: string;
    week?: string;
    day?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const inboxReturn = inboxReturnFromSearch(sp);
  const backHref = inboxReturnHref(inboxReturn);

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

  if (error) {
    return <DeskError>Could not load this call.</DeskError>;
  }
  if (!call) notFound();
  const row = call;
  const { data: person } = await workspace.client
    .from("contacts")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .eq("phone", row.caller_number)
    .maybeSingle();
  const meta = parseSummary(row.summary);
  const summaryName = typeof meta.name === "string" ? meta.name.trim() : "";
  const contactName = person?.name?.trim() || "";
  const name = contactName || summaryName || null;
  const reason = pickCallOwnerReason(meta);
  const want = pickCallOwnerWant(meta);
  const summaryCard = pickCallOwnerCard(meta);
  const urgent = String(row.sentiment || "").toLowerCase() === "urgent";
  const leadStatus = parseLeadStatus(row.lead_status);
  const resolution = parseCallResolution(row.resolution);
  const title = name || row.caller_number;
  const businessName = tenant.business_name?.trim() || "us";
  const callerSmsOn = parseNotifyChannels(tenant.notify_channels).caller_sms;
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

  const [holdRes, jobRes] = await Promise.all([
    workspace.client
      .from("service_requests")
      .select(
        "id, created_at, request_type, status, item, quantity, when_text, notes, caller_name, caller_phone, call_id"
      )
      .eq("tenant_id", tenant.id)
      .eq("call_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    workspace.client
      .from("appointments")
      .select(
        "id, created_at, service_name, status, when_text, address_landmark, notes, caller_name, caller_phone, call_id"
      )
      .eq("tenant_id", tenant.id)
      .eq("call_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const hold = holdRes.error
    ? null
    : (((holdRes.data || [])[0] || null) as InboxHold | null);
  const job = jobRes.error
    ? null
    : (((jobRes.data || [])[0] || null) as InboxJob | null);
  const workLoadError = Boolean(holdRes.error || jobRes.error);
  const purpose = classifyInboxPurpose({
    primaryIntent: row.primary_intent,
    resolution,
    leadStatus,
    hold,
    job,
    callStatus: row.status,
  });
  const workOnCall = Boolean(job || hold);
  const smsPrimary = callerSmsOn && !workOnCall;
  const waPrimary = !workOnCall && !callerSmsOn;
  const doNextText = String(summaryCard?.next || "")
    .replace(/\s+/g, " ")
    .trim();
  const doNextLabel =
    doNextText && !/^none\.?$/i.test(doNextText) ? doNextText : null;

  const titleIsPhone = !name;

  return (
    <div className="max-w-6xl min-w-0">
      <DeskBack href={backHref}>Inbox</DeskBack>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        <div className="contents min-w-0 lg:col-span-4 lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-5 lg:self-start">
          {workLoadError ? (
            <DeskError>Could not load visit or hold.</DeskError>
          ) : null}

          <div className="order-1 min-w-0 lg:order-none">
            <h1 className={`${pageTitleClass} min-w-0 [overflow-wrap:anywhere]`}>
              {person?.id ? (
                <Link
                  href={contactFromCallHref(person.id, row.id, inboxReturn)}
                  className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {title}
                </Link>
              ) : (
                title
              )}
            </h1>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <InboxPurposeChip
                purpose={purpose}
                label={signalLabel({
                  purpose,
                  hold,
                  job,
                  intent: row.primary_intent,
                  vertical: tenant.vertical,
                })}
              />
              {leadStatusReady ? (
                <LeadStatusToggle callId={row.id} initial={leadStatus} size="md" />
              ) : null}
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              {formatCallWhen(row.created_at, "full")}
            </p>
            {titleIsPhone ? null : (
              <p className="mt-1 min-w-0 break-all font-mono text-sm text-ink">
                {row.caller_number}
              </p>
            )}
          </div>

          <section
            className={[
              "order-2 min-w-0 rounded-2xl border p-5 lg:order-none",
              urgent ? "border-warn/45 bg-warn-soft/50" : "border-line bg-surface",
            ].join(" ")}
          >
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Summary
            </h2>
            <CallSummaryCard
              name={name}
              callerNumber={row.caller_number}
              want={summaryCard?.want || want}
              done={summaryCard?.done}
              mood={summaryCard?.mood}
              next={summaryCard?.next}
              urgent={urgent}
            />
          </section>

          <div className="order-3 min-w-0 space-y-5 lg:order-none">
            <div className="mx-auto flex w-full max-w-lg flex-col items-stretch gap-2">
              {doNextLabel ? (
                <div className="text-center">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Do next
                  </p>
                  <p className="mt-1 text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
                    {doNextLabel}
                  </p>
                </div>
              ) : null}

              {job ? (
                <InboxJobActions id={job.id} status={job.status} extra />
              ) : hold ? (
                <RequestStatusToggle id={hold.id} status={hold.status} extra />
              ) : smsPrimary ? (
                <CallerNoteComposer
                  callId={row.id}
                  callerPhone={row.caller_number}
                  callerName={name}
                  callerSmsOn={callerSmsOn}
                  primary
                  collapsed
                />
              ) : waPrimary && row.caller_number ? (
                <WhatsAppLink
                  number={row.caller_number}
                  message={waMessage}
                  variant="primary"
                  label="Reply on WhatsApp"
                  className="w-full"
                />
              ) : null}

              {row.caller_number && !waPrimary ? (
                <WhatsAppLink
                  number={row.caller_number}
                  message={waMessage}
                  variant="ghost"
                  label="Reply on WhatsApp"
                  className="w-full"
                />
              ) : null}

              {callerSmsOn && !smsPrimary ? (
                <CallerNoteComposer
                  callId={row.id}
                  callerPhone={row.caller_number}
                  callerName={name}
                  service={job?.service_name || hold?.item}
                  when={job?.when_text || hold?.when_text}
                  landmark={job?.address_landmark}
                  callerSmsOn={callerSmsOn}
                  primary={false}
                  collapsed
                />
              ) : null}

              {leadStatusReady ? (
                <>
                  {leadStatus !== "resolved" ? (
                    <MarkLeadDoneButton callId={row.id} variant="button" />
                  ) : null}
                  {leadStatus !== "archived" ? (
                    <MarkLeadArchiveButton callId={row.id} variant="button" />
                  ) : null}
                </>
              ) : null}
            </div>

            {job ? (
              <section className="rounded-2xl border border-line bg-surface p-4">
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Visit
                </h2>
                <div className="mt-3">
                  <InboxJobEditor
                    id={job.id}
                    whenText={job.when_text}
                    landmark={job.address_landmark}
                  />
                </div>
              </section>
            ) : null}

            {hold ? (
              <section className="rounded-2xl border border-line bg-surface p-4">
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Hold
                </h2>
                <div className="mt-3">
                  <InboxHoldEditor
                    id={hold.id}
                    whenText={hold.when_text}
                  />
                </div>
              </section>
            ) : null}
          </div>

          <div className="order-5 min-w-0 space-y-4 border-t border-line/80 pt-4 text-sm text-ink-soft lg:order-none">
            <dl className="space-y-1">
              <p>
                Duration:{" "}
                {row.duration_seconds != null ? `${row.duration_seconds}s` : "N/A"}
              </p>
              {row.resolution != null || row.resolution_note ? (
                <div className="space-y-1">
                  <p>
                    Assist:{" "}
                    <span className="font-medium text-ink">
                      {callResolutionLabel(resolution)}
                    </span>
                  </p>
                  {row.resolution_note ? (
                    <p className="[overflow-wrap:anywhere]">{row.resolution_note}</p>
                  ) : null}
                </div>
              ) : null}
              {escalatedTo?.name ? (
                <p className="[overflow-wrap:anywhere]">
                  Escalated to {escalatedTo.name}
                  {escalatedTo.role ? ` (${escalatedTo.role})` : ""}
                  {escalateReason ? `: ${escalateReason}` : ""}
                </p>
              ) : null}
            </dl>
            <CallRecording recordingUrl={row.recording_url} />
          </div>
        </div>

        <div className="order-4 min-h-0 min-w-0 space-y-8 lg:order-none lg:col-span-8 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1">
          <section>
            <h2 className="font-display text-2xl tracking-tight text-ink">
              Conversation
            </h2>
            <div className="mt-4 rounded-2xl border border-line bg-surface px-2 py-4 sm:px-4">
              {turns.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ink-soft">
                  No conversation.
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
