import { notFound } from "next/navigation";
import {
  callResolutionLabel,
  parseCallResolution,
  parseLeadStatus,
  parseSummary,
  type CallRow,
  type TranscriptRow,
} from "@/lib/supabase";
import {
  pickCallOwnerCard,
  pickCallOwnerReason,
  pickCallOwnerWant,
  shapeTicketChat,
} from "@/lib/callSummarySentence";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { InboxTicketView } from "@/components/InboxTicketView";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import {
  followUpWhatsAppMessage,
  formatCallWhenRelative,
} from "@/lib/callsTriage";
import {
  contactFromCallHref,
  inboxReturnFromSearch,
  inboxReturnHref,
} from "@/lib/inboxHref";
import {
  classifyInboxPurpose,
  inboxNeedsYou,
  isSilenceCallStatus,
  signalLabel,
  type InboxHold,
  type InboxJob,
} from "@/lib/inboxPurpose";
import { parseHandoffMode, storedPhoneCandidates } from "@/lib/handoffMode";
import { collapseJobsByCall } from "@/lib/visitPlace";
import { formatEscalationDelivery } from "@/lib/escalationDelivery";
import { formatLiveConnectStamp } from "@/lib/deskLiveTransfer";
import { normalizeTeamDirectory } from "@/lib/teamNotify";

// instant = false: request-time desk data under the owner auth shell.
export const instant = false;

/** Allow Gemini FAQ suggest + compile without premature cutoffs. */
export const maxDuration = 60;

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
    return <DeskLoadError>Could not load this call.</DeskLoadError>;
  }
  if (!call) notFound();
  const row = call;
  const phoneKeys = storedPhoneCandidates(row.caller_number);
  const { data: person } = phoneKeys.length
    ? await workspace.client
        .from("contacts")
        .select("id, name")
        .eq("tenant_id", tenant.id)
        .in("phone", phoneKeys)
        .order("phone", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const meta = parseSummary(row.summary);
  const summaryName = typeof meta.name === "string" ? meta.name.trim() : "";
  const contactName = person?.name?.trim() || "";
  const name = contactName || summaryName || null;
  const reason = pickCallOwnerReason(meta);
  const want = pickCallOwnerWant(meta);
  const summaryCard = pickCallOwnerCard(meta);
  const leadStatus = parseLeadStatus(row.lead_status);
  const resolution = parseCallResolution(row.resolution);
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
      .order("created_at", { ascending: false }),
  ]);

  const hold = holdRes.error
    ? null
    : (((holdRes.data || [])[0] || null) as InboxHold | null);
  const job = jobRes.error
    ? null
    : collapseJobsByCall((jobRes.data || []) as InboxJob[])[0] || null;
  const workLoadError = Boolean(holdRes.error || jobRes.error);
  const purpose = classifyInboxPurpose({
    primaryIntent: row.primary_intent,
    resolution,
    leadStatus,
    hold,
    job,
    callStatus: row.status,
  });
  const archived = leadStatus === "archived";
  const needsYou =
    !archived &&
    inboxNeedsYou({
      purpose,
      leadStatus,
      hold,
      job,
    });
  const doNextText = String(summaryCard?.next || "")
    .replace(/\s+/g, " ")
    .trim();
  const wantText = String(summaryCard?.want || want || "")
    .replace(/\s+/g, " ")
    .trim();
  const stamp = signalLabel({
    purpose,
    hold,
    job,
    intent: row.primary_intent,
    vertical: tenant.vertical,
  });
  const escalatedLine = escalatedTo?.name
    ? `Escalated to ${escalatedTo.name}${escalatedTo.role ? ` (${escalatedTo.role})` : ""}${
        escalateReason ? `: ${escalateReason}` : ""
      }`
    : null;
  const escalationDelivery = formatEscalationDelivery(meta);
  const handoffMode = parseHandoffMode(tenant.handoff_mode);
  const liveConnectLine = formatLiveConnectStamp(meta, handoffMode);
  const escalatePeople = normalizeTeamDirectory(tenant.team_directory, {
    ownerPhone: tenant.whatsapp_notification_number || undefined,
  }).filter(
    (row) =>
      row.receives_escalation === true &&
      Boolean(String(row.phone || "").trim() || String(row.email || "").trim())
  );
  const talked = turns.some((turn) => {
    const speaker = String(turn.speaker || "").toLowerCase();
    if (speaker !== "caller" && speaker !== "agent") return false;
    return Boolean(String(turn.text_content || "").trim());
  });
  const chat = shapeTicketChat({
    silence: isSilenceCallStatus(row.status) && !talked,
    want: wantText,
    done: summaryCard?.done,
    mood: summaryCard?.mood,
    next: doNextText,
    needsYou,
    stamp,
    whenLabel: formatCallWhenRelative(row.created_at),
  });

  return (
    <>
      {workLoadError ? <DeskLoadError>Could not load visit or hold.</DeskLoadError> : null}
      <InboxTicketView
        callId={row.id}
        backHref={backHref}
        contactHref={
          person?.id ? contactFromCallHref(person.id, row.id, inboxReturn) : null
        }
        callerName={name}
        lastContactAt={row.created_at}
        stamp={stamp}
        purpose={purpose}
        callerPhone={row.caller_number}
        waMessage={waMessage}
        needsYou={needsYou}
        urgency={chat.urgency || null}
        bannerWhen={chat.bannerWhen || null}
        want={chat.want || null}
        done={chat.done || null}
        mood={chat.mood || null}
        job={job}
        hold={hold}
        turns={turns}
        recordingUrl={row.recording_url}
        durationLabel={row.duration_seconds != null ? `${row.duration_seconds}s` : "N/A"}
        assistLabel={
          row.resolution != null || row.resolution_note
            ? callResolutionLabel(resolution)
            : null
        }
        assistNote={row.resolution_note || null}
        escalatedLine={escalatedLine}
        escalationDelivery={escalationDelivery.line}
        liveConnectLine={liveConnectLine}
        escalatePeople={escalatePeople.map((row) => ({
          name: row.name,
          role: row.role,
          phone: row.phone,
          email: row.email,
        }))}
        archived={archived}
        leadStatus={leadStatus}
        businessName={businessName}
      />
    </>
  );
}
