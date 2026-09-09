import type { CallResolution, LeadStatus } from "@/lib/supabase";
import type { Lead } from "@/lib/callsTriage";
import { nicheCopy, purposeFilters } from "@/lib/inboxNiche";

export type InboxPurpose = "job" | "hold" | "human" | "missed" | "answered";

export type InboxPurposeFilterId =
  | "needs"
  | "hold"
  | "job"
  | "human"
  | "answered"
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
  "product_inquiry",
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
};

export function purposeLabel(purpose: InboxPurpose, vertical?: string | null): string {
  const copy = nicheCopy(vertical);
  switch (purpose) {
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
    const status = String(opts.job?.status || "").toLowerCase();
    if (status === "confirmed") return copy.visitStamp;
    if (status === "done") return copy.visitDoneStamp;
    if (status === "cancelled") return "Cancelled";
    return copy.confirmStamp;
  }
  if (opts.purpose === "hold") {
    const status = String(opts.hold?.status || "").toLowerCase();
    if (status === "fulfilled") return "Item done";
    if (status === "cancelled") return "Cancelled";
    return holdTypeLabel(
      opts.hold?.request_type || opts.intent || "hold",
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
  const needs = items.filter((item) => item.needsYou).length;
  if (needs === 0) return "Clear";
  const toConfirm = items.filter(
    (item) => item.job && String(item.job.status || "").toLowerCase() === "requested"
  ).length;
  const toFulfill = items.filter(
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
  if (item.purpose === "job" && item.needsYou) return 1;
  if (item.purpose === "hold" && item.needsYou) return 2;
  if (item.purpose === "missed" && item.needsYou) return 3;
  if (item.purpose === "human" && item.needsYou) return 4;
  if (item.needsYou) return 5;
  return 6;
}

export function compareInboxSignal(a: InboxItem, b: InboxItem): number {
  const rank = signalRank(a) - signalRank(b);
  if (rank !== 0) return rank;
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return 0;
}

export function homeQueueUnit(
  count: number,
  fallback: string,
  sample?: string | null
): string {
  if (count === 1) {
    const text = sample?.trim();
    if (text) return text;
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

export function summarizeInboxWork(items: InboxItem[]): {
  needs: number;
  toReturn: number;
  toFulfill: number;
  toConfirm: number;
  nextHold: InboxItem | null;
  nextJob: InboxItem | null;
} {
  const needs = items.filter((item) => item.needsYou);
  const toReturn = needs.filter(
    (item) => item.purpose === "human" || item.purpose === "missed"
  );
  const toFulfill = needs.filter((item) => item.purpose === "hold");
  const toConfirm = needs.filter((item) => item.purpose === "job");
  return {
    needs: needs.length,
    toReturn: toReturn.length,
    toFulfill: toFulfill.length,
    toConfirm: toConfirm.length,
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
}): InboxPurpose {
  if (opts.job) return "job";
  if (opts.hold) return "hold";

  const intent = canonicalInboxIntent(opts.primaryIntent);
  const resolution = opts.resolution || "unknown";

  if (HUMAN_INTENTS.has(intent) || resolution === "needs_human") return "human";
  if (JOB_INTENTS.has(intent)) return "job";
  if (HOLD_INTENTS.has(intent)) return "hold";
  if (resolution === "abandoned" || resolution === "unresolved") return "missed";
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
  if (opts.purpose === "answered") return false;
  const jobStatus = String(opts.job?.status || "").toLowerCase();
  const holdStatus = String(opts.hold?.status || "").toLowerCase();
  if (opts.job && (jobStatus === "requested" || jobStatus === "confirmed")) {
    return true;
  }
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
  for (const lead of opts.leads) {
    if (lead.leadStatus === "archived") continue;
    const hold = holdByCall.get(lead.call.id) || null;
    const job = jobByCall.get(lead.call.id) || null;
    if (hold) usedHold.add(hold.id);
    if (job) usedJob.add(job.id);
    items.push(buildInboxItem({ lead, hold, job, vertical }));
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

export function attachContactIds(
  items: InboxItem[],
  contacts: Array<{ id: string; phone: string | null }>
): InboxItem[] {
  const byPhone = new Map<string, string>();
  for (const row of contacts) {
    if (row.phone) byPhone.set(row.phone, row.id);
  }
  return items.map((item) => ({
    ...item,
    contactId: item.callerPhone ? byPhone.get(item.callerPhone) || null : null,
  }));
}

export function itemMatchesPurpose(
  item: InboxItem,
  filter: InboxPurposeFilterId
): boolean {
  if (filter === "all") return true;
  if (filter === "needs") return item.needsYou;
  if (filter === "hold") return item.purpose === "hold";
  if (filter === "job") return item.purpose === "job";
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
    all: items.length,
  };
  for (const item of items) {
    if (item.needsYou) counts.needs += 1;
    if (item.purpose === "hold") counts.hold += 1;
    if (item.purpose === "job") counts.job += 1;
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

const PURPOSE_IDS = new Set<InboxPurposeFilterId>(
  PURPOSE_FILTERS.map((f) => f.id)
);

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
  if (statusRaw === "archived") return "all";
  return needsCount > 0 ? "needs" : "all";
}
