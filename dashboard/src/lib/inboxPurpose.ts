import type { CallResolution, LeadStatus } from "@/lib/supabase";
import type { Lead } from "@/lib/callsTriage";
import { nicheCopy, purposeFilters } from "@/lib/inboxNiche";
import { storedPhoneCandidates, storedPhoneJoinKey } from "@/lib/handoffMode";

export type InboxPurpose = "job" | "hold" | "human" | "missed" | "answered" | "live";

export type InboxPurposeFilterId =
  | "needs"
  | "hold"
  | "job"
  | "human"
  | "answered"
  | "archived"
  | "all";

export const PURPOSE_FILTERS = purposeFilters("general");

/** Brain persist ids. Desk must read these, not the short aliases. */
const INTENT_ALIASES: Record<string, string> = {
  hold: "hold_or_pickup",
  hold_or_pickup: "hold_or_pickup",
  hours: "hours_open",
  hours_open: "hours_open",
  location: "directions",
  directions: "directions",
  order: "order_enquiry",
  order_enquiry: "order_enquiry",
  enquiry: "order_enquiry",
  booking: "book_visit",
  book_visit: "book_visit",
  cancellation: "cancel",
  cancel: "cancel",
  reschedule: "reschedule",
};

const JOB_INTENTS = new Set(["book_visit", "reschedule", "cancel"]);

const HOLD_INTENTS = new Set([
  "hold_or_pickup",
  "order_enquiry",
  "callback",
  "hold",
  "order",
]);

const HUMAN_INTENTS = new Set([
  "human",
  "emergency",
  "complaint",
  "escalate",
  "handoff",
]);

const ANSWER_INTENTS = new Set([
  "hours",
  "hours_open",
  "location",
  "directions",
  "price",
  "price_band",
  "availability",
  "policy",
  "service_inquiry",
  "service_area",
  "general_enquiry",
  "other",
]);

export function canonicalInboxIntent(raw?: string | null): string {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  if (!key || key === "unknown") return "";
  return INTENT_ALIASES[key] || key;
}

export type InboxHold = {
  id: string;
  created_at: string;
  request_type: string;
  status: string;
  item: string | null;
  quantity: string | null;
  when_text: string | null;
  notes: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  call_id: string | null;
};

export type InboxJob = {
  id: string;
  created_at: string;
  service_name: string;
  status: string;
  when_text: string | null;
  window_start?: string | null;
  window_end?: string | null;
  address_landmark: string | null;
  notes: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  call_id: string | null;
};

export type InboxItem = {
  id: string;
  createdAt: string;
  purpose: InboxPurpose;
  needsYou: boolean;
  callerName: string | null;
  callerPhone: string | null;
  contactId: string | null;
  headline: string;
  detail: string | null;
  callId: string | null;
  lead: Lead | null;
  hold: InboxHold | null;
  job: InboxJob | null;
  intent: string | null;
  urgent: boolean;
  unread: boolean;
  muted: boolean;
  pinnedAt: string | null;
  assignee: string | null;
  labels: string[];
  snoozedUntil: string | null;
};

/** Latest inbound call, hold, or visit created from the caller. */
export function inboxLastCustomerEventAt(opts: {
  callCreatedAt?: string | null;
  holdCreatedAt?: string | null;
  jobCreatedAt?: string | null;
}): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const iso of [opts.callCreatedAt, opts.holdCreatedAt, opts.jobCreatedAt]) {
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    if (ms >= latestMs) {
      latestMs = ms;
      latest = iso;
    }
  }
  return latest;
}

/** Unread when a customer event exists after the owner last opened the ticket. */
export function inboxIsUnread(opts: {
  lastCustomerEventAt?: string | null;
  inboxReadAt?: string | null;
}): boolean {
  const eventMs = opts.lastCustomerEventAt ? Date.parse(opts.lastCustomerEventAt) : Number.NaN;
  if (!Number.isFinite(eventMs)) return false;
  if (!opts.inboxReadAt) return true;
  const readMs = Date.parse(opts.inboxReadAt);
  if (!Number.isFinite(readMs)) return true;
  return eventMs > readMs;
}

export function isLiveCallStatus(status?: string | null): boolean {
  const s = String(status || "").toLowerCase();
  return s === "in_progress" || s === "ringing" || s === "queued";
}

export function purposeLabel(purpose: InboxPurpose, vertical?: string | null): string {
  const copy = nicheCopy(vertical);
  switch (purpose) {
    case "live":
      return "Live";
    case "job":
      return copy.visitStamp;
    case "hold":
      return "Hold";
    case "human":
      return "Human asked";
    case "missed":
      return "Missed";
    default:
      return "Answered";
  }
}

/** Next action in the owner's niche language. */
export function signalLabel(opts: {
  purpose: InboxPurpose;
  hold?: InboxHold | null;
  job?: InboxJob | null;
  intent?: string | null;
  vertical?: string | null;
}): string {
  const copy = nicheCopy(opts.vertical);
  if (opts.purpose === "job") {
    if (!opts.job) return copy.visitGhostStamp;
    const status = String(opts.job.status || "").toLowerCase();
    if (status === "confirmed") return copy.visitStamp;
    if (status === "done") return copy.visitDoneStamp;
    if (status === "cancelled") return "Cancelled";
    return copy.confirmStamp;
  }
  if (opts.purpose === "hold") {
    if (!opts.hold) return copy.holdGhostStamp;
    const status = String(opts.hold.status || "").toLowerCase();
    if (status === "fulfilled") return "Item done";
    if (status === "cancelled") return "Cancelled";
    return holdTypeLabel(
      opts.hold.request_type || opts.intent || "hold",
      opts.vertical
    );
  }
  return purposeLabel(opts.purpose, opts.vertical);
}

export function itemSignalLabel(
  item: InboxItem,
  vertical?: string | null
): string {
  return signalLabel({
    purpose: item.purpose,
    hold: item.hold,
    job: item.job,
    intent: item.intent,
    vertical,
  });
}

export function inboxCaption(
  items: InboxItem[],
  vertical?: string | null
): string {
  const copy = nicheCopy(vertical);
  const live = items.filter((item) => !itemIsArchived(item));
  const needs = live.filter((item) => item.needsYou).length;
  if (needs === 0) return "Clear";
  const toConfirm = live.filter(
    (item) => item.job && String(item.job.status || "").toLowerCase() === "requested"
  ).length;
  const toFulfill = live.filter(
    (item) => item.hold && String(item.hold.status || "").toLowerCase() === "open"
  ).length;
  if (toConfirm === needs) {
    return `${toConfirm} ${copy.jobUnit}`;
  }
  if (toFulfill === needs) {
    return `${toFulfill} ${copy.holdUnit}`;
  }
  const bits = [`${needs} need you`];
  if (toConfirm > 0) bits.push(`${toConfirm} ${copy.jobUnit}`);
  else if (toFulfill > 0) bits.push(`${toFulfill} ${copy.holdUnit}`);
  return bits.length === 1 ? bits[0] : `${bits[0]}. ${bits[1]}.`;
}

function signalRank(item: InboxItem): number {
  if (item.urgent && item.needsYou) return 0;
  return 1;
}

export function compareInboxRecency(a: InboxItem, b: InboxItem): number {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return 0;
}

export function compareInboxSignal(a: InboxItem, b: InboxItem): number {
  const rank = signalRank(a) - signalRank(b);
  if (rank !== 0) return rank;
  return compareInboxRecency(a, b);
}

export function compareInboxPin(a: InboxItem, b: InboxItem): number {
  const ap = a.pinnedAt || "";
  const bp = b.pinnedAt || "";
  if (ap && !bp) return -1;
  if (!ap && bp) return 1;
  if (ap && bp && ap !== bp) return ap < bp ? 1 : -1;
  return 0;
}

export function itemIsSnoozed(item: InboxItem, now = Date.now()): boolean {
  if (!item.snoozedUntil) return false;
  const until = Date.parse(item.snoozedUntil);
  return Number.isFinite(until) && until > now;
}

/** All, Answered, Archived, and Holds List are a tape: newest first. Pinned rows stay on top of the current pile. */
export function orderInboxItems(
  items: InboxItem[],
  filter: InboxPurposeFilterId
): InboxItem[] {
  const rows = [...items];
  if (filter === "all" || filter === "answered" || filter === "archived" || filter === "hold") {
    rows.sort(compareInboxRecency);
  }
  rows.sort(compareInboxPin);
  return rows;
}

/** Queue labels stay nouns. A single short slot may replace the unit. Never a paragraph. */
export const HOME_QUEUE_SAMPLE_MAX = 28;

export function homeQueueUnit(
  count: number,
  fallback: string,
  sample?: string | null
): string {
  if (count === 1) {
    const text = sample?.trim() || "";
    if (text && text.length <= HOME_QUEUE_SAMPLE_MAX) return text;
  }
  return fallback;
}

export function homeBriefing(
  opts: {
    toReturn: number;
    toFulfill: number;
    toConfirm: number;
  },
  vertical?: string | null
): string {
  const copy = nicheCopy(vertical);
  const bits: string[] = [];
  if (opts.toConfirm > 0) bits.push(`${opts.toConfirm} ${copy.jobUnit}`);
  if (opts.toFulfill > 0) bits.push(`${opts.toFulfill} ${copy.holdUnit}`);
  if (opts.toReturn > 0) bits.push(`${opts.toReturn} ${copy.returnUnit}`);
  if (bits.length === 0) return "Clear";
  return `${bits.join(". ")}.`;
}

/**
 * One-line digest of the receptionist's Nairobi day: what it closed, what it
 * booked, what needs a look. Null when nothing happened worth saying.
 */
export function homeDigestLine(
  items: InboxItem[],
  dayStartIso: string,
  vertical?: string | null
): string | null {
  const copy = nicheCopy(vertical);
  const dayStartMs = new Date(dayStartIso).getTime();
  const today = items.filter((item) => new Date(item.createdAt).getTime() >= dayStartMs);
  const answered = today.filter((item) => item.purpose === "answered").length;
  const booked = today.filter(
    (item) => item.job && new Date(item.job.created_at).getTime() >= dayStartMs
  ).length;
  const complaints = today.filter(
    (item) => canonicalInboxIntent(item.intent) === "complaint"
  ).length;
  const bits: string[] = [];
  if (answered > 0) bits.push(`${answered} answered`);
  if (booked > 0) {
    const noun = booked === 1 ? copy.visitStamp : copy.jobFilter;
    bits.push(`${booked} ${noun.toLowerCase()}`);
  }
  if (complaints > 0) bits.push(`${complaints} complaint${complaints === 1 ? "" : "s"}`);
  return bits.length ? `Today: ${bits.join(", ")}.` : null;
}

export function summarizeInboxWork(items: InboxItem[]): {
  needs: number;
  toReturn: number;
  toFulfill: number;
  toConfirm: number;
  nextReturn: InboxItem | null;
  nextHold: InboxItem | null;
  nextJob: InboxItem | null;
} {
  const needs = items.filter((item) => item.needsYou);
  const toConfirm = needs.filter(
    (item) => item.job && String(item.job.status || "").toLowerCase() === "requested"
  );
  const toFulfill = needs.filter(
    (item) => item.hold && String(item.hold.status || "").toLowerCase() === "open"
  );
  const toReturn = needs.filter((item) => !item.job && !item.hold);
  return {
    needs: needs.length,
    toReturn: toReturn.length,
    toFulfill: toFulfill.length,
    toConfirm: toConfirm.length,
    nextReturn: toReturn[0] || null,
    nextHold: toFulfill[0] || null,
    nextJob: toConfirm[0] || null,
  };
}

export function holdTypeLabel(type: string, vertical?: string | null): string {
  const copy = nicheCopy(vertical);
  const key = canonicalInboxIntent(type) || String(type || "").toLowerCase();
  switch (key) {
    case "hold_or_pickup":
    case "hold":
      return copy.pickupStamp;
    case "order_enquiry":
    case "order":
      return "Order";
    case "callback":
      return "Callback";
    case "enquiry":
      return "Enquiry";
    default:
      return type || copy.pickupStamp;
  }
}

export function classifyInboxPurpose(opts: {
  primaryIntent?: string | null;
  resolution?: CallResolution | null;
  leadStatus?: LeadStatus | null;
  hold?: InboxHold | null;
  job?: InboxJob | null;
  callStatus?: string | null;
}): InboxPurpose {
  if (isLiveCallStatus(opts.callStatus)) return "live";
  if (opts.job) return "job";
  if (opts.hold) return "hold";

  const intent = canonicalInboxIntent(opts.primaryIntent);
  const resolution = opts.resolution || "unknown";

  if (HUMAN_INTENTS.has(intent) || resolution === "needs_human") return "human";
  if (JOB_INTENTS.has(intent)) return "job";
  if (HOLD_INTENTS.has(intent)) return "hold";
  if (resolution === "abandoned" || resolution === "unresolved") return "missed";
  // Product inquiry is an active lead unless a job or hold row already attached.
  if (intent === "product_inquiry") return "missed";
  if (resolution === "resolved" || ANSWER_INTENTS.has(intent)) return "answered";
  if (opts.leadStatus === "new") return "missed";
  return "answered";
}

function leadStillOpen(leadStatus?: LeadStatus | null): boolean {
  return leadStatus !== "resolved" && leadStatus !== "archived";
}

export function inboxNeedsYou(opts: {
  purpose: InboxPurpose;
  leadStatus?: LeadStatus | null;
  hold?: InboxHold | null;
  job?: InboxJob | null;
}): boolean {
  if (opts.purpose === "live") return true;
  if (opts.purpose === "answered") return false;
  const jobStatus = String(opts.job?.status || "").toLowerCase();
  const holdStatus = String(opts.hold?.status || "").toLowerCase();
  if (opts.job && jobStatus === "requested") return true;
  if (opts.hold && holdStatus === "open") return true;
  if (opts.purpose === "job" && !opts.job && leadStillOpen(opts.leadStatus)) {
    return true;
  }
  if (opts.purpose === "hold" && !opts.hold && leadStillOpen(opts.leadStatus)) {
    return true;
  }
  if (opts.purpose === "human" && leadStillOpen(opts.leadStatus)) return true;
  if (opts.purpose === "missed" && leadStillOpen(opts.leadStatus)) return true;
  return false;
}

export function holdHeadline(hold: InboxHold, vertical?: string | null): string {
  const item = hold.item?.trim();
  if (item) {
    return hold.quantity ? `${item} x${hold.quantity}` : item;
  }
  return holdTypeLabel(hold.request_type, vertical);
}

export function jobHeadline(job: InboxJob, vertical?: string | null): string {
  return job.service_name?.trim() || nicheCopy(vertical).visitStamp;
}

export function jobDetail(job: InboxJob): string | null {
  const parts = [job.when_text, job.address_landmark].filter(Boolean);
  return parts.length ? parts.join(" · ") : job.notes;
}

export function buildInboxItem(opts: {
  lead?: Lead | null;
  hold?: InboxHold | null;
  job?: InboxJob | null;
  vertical?: string | null;
}): InboxItem {
  const lead = opts.lead || null;
  const hold = opts.hold || null;
  const job = opts.job || null;
  const vertical = opts.vertical || null;
  const intent = canonicalInboxIntent(lead?.primaryIntent) || null;
  const purpose = classifyInboxPurpose({
    primaryIntent: lead?.primaryIntent,
    resolution: lead?.resolution,
    leadStatus: lead?.leadStatus,
    hold,
    job,
    callStatus: lead?.call.status,
  });
  const needsYou = inboxNeedsYou({
    purpose,
    leadStatus: lead?.leadStatus,
    hold,
    job,
  });

  const callerName =
    job?.caller_name || hold?.caller_name || lead?.name || null;
  const callerPhone =
    job?.caller_phone || hold?.caller_phone || lead?.call.caller_number || null;

  let headline = lead?.reason || purposeLabel(purpose, vertical);
  let detail: string | null = lead?.primaryIntent || null;
  if (job) {
    headline = jobHeadline(job, vertical);
    detail = jobDetail(job);
  } else if (hold) {
    headline = holdHeadline(hold, vertical);
    const when = hold.when_text?.trim();
    detail = when || hold.notes;
  }

  const createdAt =
    lead?.call.created_at || job?.created_at || hold?.created_at || new Date().toISOString();
  const id = lead?.call.id || job?.id || hold?.id || createdAt;
  const labels = Array.isArray(lead?.call.inbox_labels)
    ? lead.call.inbox_labels.filter((row): row is string => typeof row === "string")
    : [];

  return {
    id,
    createdAt,
    purpose,
    needsYou,
    callerName,
    callerPhone,
    contactId: null,
    headline,
    detail,
    callId: lead?.call.id || job?.call_id || hold?.call_id || null,
    lead,
    hold,
    job,
    intent: intent || canonicalInboxIntent(hold?.request_type) || null,
    urgent: Boolean(lead?.urgent),
    unread: inboxIsUnread({
      lastCustomerEventAt: inboxLastCustomerEventAt({
        callCreatedAt: lead?.call.created_at,
        holdCreatedAt: hold?.created_at,
        jobCreatedAt: job?.created_at,
      }),
      inboxReadAt: lead?.call.inbox_read_at,
    }),
    muted: Boolean(lead?.call.inbox_muted),
    pinnedAt: lead?.call.inbox_pinned_at || null,
    assignee: lead?.call.inbox_assignee?.trim() || null,
    labels,
    snoozedUntil: lead?.call.inbox_snoozed_until || null,
  };
}

export function assembleInboxItems(opts: {
  leads: Lead[];
  holds: InboxHold[];
  jobs: InboxJob[];
  vertical?: string | null;
}): InboxItem[] {
  const holdByCall = new Map<string, InboxHold>();
  const jobByCall = new Map<string, InboxJob>();
  const usedHold = new Set<string>();
  const usedJob = new Set<string>();
  const vertical = opts.vertical || null;

  for (const hold of opts.holds) {
    if (hold.call_id && !holdByCall.has(hold.call_id)) {
      holdByCall.set(hold.call_id, hold);
    }
  }
  for (const job of opts.jobs) {
    if (job.call_id && !jobByCall.has(job.call_id)) {
      jobByCall.set(job.call_id, job);
    }
  }

  const items: InboxItem[] = [];
  const now = Date.now();
  for (const lead of opts.leads) {
    const hold = holdByCall.get(lead.call.id) || null;
    const job = jobByCall.get(lead.call.id) || null;
    const draft = buildInboxItem({ lead, hold, job, vertical });
    if (itemIsSnoozed(draft, now)) {
      if (hold) usedHold.add(hold.id);
      if (job) usedJob.add(job.id);
      continue;
    }
    if (hold) usedHold.add(hold.id);
    if (job) usedJob.add(job.id);
    items.push(draft);
  }

  for (const hold of opts.holds) {
    if (usedHold.has(hold.id)) continue;
    items.push(buildInboxItem({ hold, vertical }));
  }
  for (const job of opts.jobs) {
    if (usedJob.has(job.id)) continue;
    items.push(buildInboxItem({ job, vertical }));
  }

  items.sort(compareInboxSignal);
  return items;
}

export function resolveDisplayedCallerName(
  item: InboxItem,
  contactName?: string | null
): string | null {
  const fromContact = String(contactName || "").trim() || null;
  const fromSummary = String(item.lead?.name || "").trim() || null;
  const fromHoldOrJob =
    String(item.job?.caller_name || item.hold?.caller_name || "").trim() || null;
  return fromContact || fromSummary || fromHoldOrJob || item.callerPhone || null;
}

export function attachContactIds(
  items: InboxItem[],
  contacts: Array<{ id: string; phone: string | null; name?: string | null }>
): InboxItem[] {
  const byPhone = new Map<string, { id: string; name: string | null }>();
  const remember = (phone: string | null | undefined, person: { id: string; name: string | null }) => {
    for (const key of storedPhoneCandidates(phone)) {
      byPhone.set(key, person);
    }
  };
  for (const row of contacts) {
    if (!row.phone) continue;
    remember(row.phone, {
      id: row.id,
      name: row.name?.trim() || null,
    });
  }
  return items.map((item) => {
    const person =
      (item.callerPhone &&
        (byPhone.get(item.callerPhone) ||
          byPhone.get(storedPhoneJoinKey(item.callerPhone) || ""))) ||
      null;
    return {
      ...item,
      contactId: person?.id || null,
      callerName: resolveDisplayedCallerName(item, person?.name || null),
    };
  });
}

export function itemIsArchived(item: InboxItem): boolean {
  return item.lead?.leadStatus === "archived";
}

export function itemMatchesPurpose(
  item: InboxItem,
  filter: InboxPurposeFilterId
): boolean {
  if (filter === "archived") return itemIsArchived(item);
  if (itemIsArchived(item)) return false;
  if (filter === "all") return true;
  if (filter === "needs") return item.needsYou;
  if (filter === "hold") {
    return String(item.hold?.status || "").toLowerCase() === "open";
  }
  if (filter === "job") {
    const status = String(item.job?.status || "").toLowerCase();
    return status === "requested" || status === "confirmed";
  }
  if (filter === "human") return item.purpose === "human" || item.purpose === "missed";
  if (filter === "answered") return item.purpose === "answered";
  return true;
}

export function countInboxPurposes(items: InboxItem[]): Record<InboxPurposeFilterId, number> {
  const counts: Record<InboxPurposeFilterId, number> = {
    needs: 0,
    hold: 0,
    job: 0,
    human: 0,
    answered: 0,
    archived: 0,
    all: 0,
  };
  for (const item of items) {
    if (itemIsArchived(item)) {
      counts.archived += 1;
      continue;
    }
    counts.all += 1;
    if (item.needsYou) counts.needs += 1;
    if (itemMatchesPurpose(item, "hold")) counts.hold += 1;
    if (itemMatchesPurpose(item, "job")) counts.job += 1;
    if (item.purpose === "human" || item.purpose === "missed") counts.human += 1;
    if (item.purpose === "answered") counts.answered += 1;
  }
  return counts;
}

export function itemMatchesQuery(item: InboxItem, q: string): boolean {
  if (!q) return true;
  const hay = [
    item.callerName,
    item.callerPhone,
    item.headline,
    item.detail,
    item.lead?.reason,
    item.lead?.call.summary,
    item.intent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

const PURPOSE_IDS = new Set<InboxPurposeFilterId>([
  ...PURPOSE_FILTERS.map((f) => f.id),
  "archived",
]);

/** Map legacy lead-status bookmarks onto purpose filters. */
export function resolvePurposeFilter(
  purposeRaw: string | undefined,
  statusRaw: string | undefined,
  needsCount: number
): InboxPurposeFilterId {
  const purpose = String(purposeRaw || "").toLowerCase();
  if (PURPOSE_IDS.has(purpose as InboxPurposeFilterId)) {
    return purpose as InboxPurposeFilterId;
  }
  if (statusRaw === "all") return "all";
  if (statusRaw === "new") return "needs";
  if (statusRaw === "contacted") return "human";
  if (statusRaw === "resolved") return "answered";
  if (statusRaw === "archived") return "archived";
  return needsCount > 0 ? "needs" : "all";
}
