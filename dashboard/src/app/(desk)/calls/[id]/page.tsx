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
import { CallerNoteComposer } from "@/components/CallerNoteComposer";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { pageTitleClass } from "@/components/ui/deskChrome";
import { DeskError } from "@/components/ui/DeskError";
import { parseNotifyChannels } from "@/lib/notifyChannels";
import {
  callsHref,
  followUpWhatsAppMessage,
  formatCallWhen,
} from "@/lib/callsTriage";
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

function parseFromFilter(raw: string | undefined): string | undefined {
  if (
    raw === "needs" ||
    raw === "hold" ||
    raw === "job" ||
    raw === "human" ||
    raw === "answered" ||
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
  const backHref = fromFilter
    ? fromFilter === "new" ||
      fromFilter === "contacted" ||
      fromFilter === "resolved" ||
      fromFilter === "archived"
      ? callsHref({
          status: fromFilter as "new" | "contacted" | "resolved" | "archived",
        })
      : callsHref({ purpose: fromFilter })
    : "/calls";
  const backLabel = "Inbox";

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
  const transferAttempt =
    meta.transfer_attempt && typeof meta.transfer_attempt === "object"
      ? (meta.transfer_attempt as { status?: string })
      : null;

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

  const titleIsPhone = !name;

  return (
    <div className="max-w-6xl">
      <Link
        href={backHref}
        className="text-sm font-medium text-accent-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {backLabel}
      </Link>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        <aside className="space-y-5 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
          <div>
            <h1 className={pageTitleClass}>
              {title}
            </h1>
            <div className="mt-3">
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
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              {formatCallWhen(row.created_at, "full")}
            </p>
            {titleIsPhone ? null : (
              <p className="mt-1 font-mono text-sm text-ink">{row.caller_number}</p>
            )}
            {urgent ? (
              <p className="mt-2 text-sm font-medium text-warn">Urgent</p>
            ) : null}
            {person?.id ? (
              <Link
                href={`/contacts/${person.id}`}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open contact
              </Link>
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
                Summary
              </h2>
              {leadStatusReady ? (
                <LeadStatusToggle callId={row.id} initial={leadStatus} size="md" />
              ) : null}
            </div>
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

          {job ? (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Visit
              </h2>
              <div className="mt-3">
                <InboxJobEditor
                  id={job.id}
                  status={job.status}
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
                  status={hold.status}
                  whenText={hold.when_text}
                />
              </div>
            </section>
          ) : null}

          {callerSmsOn ? (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <CallerNoteComposer
                callId={row.id}
                callerPhone={row.caller_number}
                callerName={name}
                service={job?.service_name || hold?.item}
                when={job?.when_text || hold?.when_text}
                landmark={job?.address_landmark}
                callerSmsOn={callerSmsOn}
                primary={smsPrimary}
              />
            </section>
          ) : null}

          {row.caller_number ? (
            <WhatsAppLink
              number={row.caller_number}
              message={waMessage}
              variant={waPrimary ? "primary" : "link"}
              label="Reply on WhatsApp"
              className="w-full"
            />
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

          <dl className="space-y-1 border-t border-line/80 pt-4 text-sm text-ink">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Duration:{" "}
                {row.duration_seconds != null ? `${row.duration_seconds}s` : "N/A"}
              </span>
              <span>Alert sent: {meta.whatsapp_sent ? "yes" : "no"}</span>
              <span>Escalation: {meta.escalation_sent ? "sent" : "no"}</span>
              {transferAttempt?.status ? (
                <span>Transfer: {transferAttempt.status}</span>
              ) : null}
            </div>
            {row.resolution != null || row.primary_intent || row.resolution_note ? (
              <div className="space-y-1">
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
              <p>
                Escalated to {escalatedTo.name}
                {escalatedTo.role ? ` (${escalatedTo.role})` : ""}
                {escalateReason ? `: ${escalateReason}` : ""}
              </p>
            ) : null}
          </dl>

          <CallRecording recordingUrl={row.recording_url} />
        </aside>

        {/* RIGHT PANE: transcript + FAQ ideas */}
        <div className="min-h-0 space-y-8 lg:col-span-8 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1">
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
