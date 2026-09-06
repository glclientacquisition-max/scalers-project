import type { CallResolution, LeadStatus } from "@/lib/supabase";
import type { Lead } from "@/lib/callsTriage";

export type InboxPurpose = "job" | "hold" | "human" | "missed" | "answered";

export type InboxPurposeFilterId =
  | "needs"
  | "hold"
  | "job"
  | "human"
  | "answered"
  | "all";

export const PURPOSE_FILTERS = [
  { id: "needs", label: "Needs you" },
  { id: "hold", label: "Holds" },
  { id: "job", label: "Jobs" },
  { id: "human", label: "Human" },
  { id: "answered", label: "Answered" },
  { id: "all", label: "All" },
] as const;

const JOB_INTENTS = new Set([
  "book_visit",
  "booking",
  "reschedule",
  "cancel",
  "cancellation",
]);

const HOLD_INTENTS = new Set([
  "hold",
  "hold_or_pickup",
  "order",
  "order_enquiry",
  "enquiry",
  "callback",
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
  headline: string;
  detail: string | null;
  callId: string | null;
  lead: Lead | null;
  hold: InboxHold | null;
  job: InboxJob | null;
  urgent: boolean;
};

export function purposeLabel(purpose: InboxPurpose): string {
  switch (purpose) {
    case "job":
      return "Job";
    case "hold":
      return "Hold";
    case "human":
      return "Human";
    case "missed":
      return "Missed";
    default:
      return "Answered";
  }
}

export function holdTypeLabel(type: string): string {
  switch (type) {
    case "hold":
      return "Hold";
    case "order":
      return "Order";
    case "callback":
      return "Callback";
    case "enquiry":
      return "Enquiry";
    default:
      return type || "Hold";
  }
}

export function classifyInboxPurpose(opts: {
  primaryIntent?: string | null;
  resolution?: CallResolution | null;
  leadStatus?: LeadStatus | null;
  hold?: InboxHold | null;
  job?: InboxJob | null;
  inboxPurpose?: string | null;
}): InboxPurpose {
  if (opts.job) return "job";
  if (opts.hold) return "hold";

  const stamped = String(opts.inboxPurpose || "")
    .trim()
    .toLowerCase();
  if (
    stamped === "job" ||
    stamped === "hold" ||
    stamped === "human" ||
    stamped === "missed" ||
    stamped === "answered"
  ) {
    return stamped;
  }

  const intent = String(opts.primaryIntent || "")
    .trim()
    .toLowerCase();
  const resolution = opts.resolution || "unknown";

  if (HUMAN_INTENTS.has(intent) || resolution === "needs_human") return "human";
  if (JOB_INTENTS.has(intent)) return "job";
  if (HOLD_INTENTS.has(intent)) return "hold";
  if (resolution === "abandoned" || resolution === "unresolved") return "missed";
  if (resolution === "resolved" || ANSWER_INTENTS.has(intent)) return "answered";
  if (opts.leadStatus === "new") return "missed";
  return "answered";
}

export function inboxNeedsYou(opts: {
  purpose: InboxPurpose;
  leadStatus?: LeadStatus | null;
  hold?: InboxHold | null;
  job?: InboxJob | null;
}): boolean {
  const jobStatus = String(opts.job?.status || "").toLowerCase();
  const holdStatus = String(opts.hold?.status || "").toLowerCase();
  if (opts.job && (jobStatus === "requested" || jobStatus === "confirmed")) {
    return true;
  }
  if (opts.hold && holdStatus === "open") return true;
  if (opts.purpose === "human" && opts.leadStatus !== "resolved" && opts.leadStatus !== "archived") {
    return true;
  }
  if (opts.purpose === "missed" && opts.leadStatus !== "resolved" && opts.leadStatus !== "archived") {
    return true;
  }
  return false;
}

export function holdHeadline(hold: InboxHold): string {
  const item = hold.item?.trim();
  if (item) {
    return hold.quantity ? `${item} x${hold.quantity}` : item;
  }
  return holdTypeLabel(hold.request_type);
}

export function jobHeadline(job: InboxJob): string {
  return job.service_name?.trim() || "Visit";
}

export function jobDetail(job: InboxJob): string | null {
  const parts = [job.when_text, job.address_landmark].filter(Boolean);
  return parts.length ? parts.join(" · ") : job.notes;
}

export function buildInboxItem(opts: {
  lead?: Lead | null;
  hold?: InboxHold | null;
  job?: InboxJob | null;
}): InboxItem {
  const lead = opts.lead || null;
  const hold = opts.hold || null;
  const job = opts.job || null;
  const purpose = classifyInboxPurpose({
    primaryIntent: lead?.primaryIntent,
    resolution: lead?.resolution,
    leadStatus: lead?.leadStatus,
    hold,
    job,
    inboxPurpose: lead?.inboxPurpose,
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

  let headline = lead?.reason || purposeLabel(purpose);
  let detail: string | null = lead?.primaryIntent || null;
  if (job) {
    headline = jobHeadline(job);
    detail = jobDetail(job);
  } else if (hold) {
    headline = holdHeadline(hold);
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
    headline,
    detail,
    callId: lead?.call.id || job?.call_id || hold?.call_id || null,
    lead,
    hold,
    job,
    urgent: Boolean(lead?.urgent),
  };
}

export function assembleInboxItems(opts: {
  leads: Lead[];
  holds: InboxHold[];
  jobs: InboxJob[];
}): InboxItem[] {
  const holdByCall = new Map<string, InboxHold>();
  const jobByCall = new Map<string, InboxJob>();
  const usedHold = new Set<string>();
  const usedJob = new Set<string>();

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
    items.push(buildInboxItem({ lead, hold, job }));
  }

  for (const hold of opts.holds) {
    if (usedHold.has(hold.id)) continue;
    items.push(buildInboxItem({ hold }));
  }
  for (const job of opts.jobs) {
    if (usedJob.has(job.id)) continue;
    items.push(buildInboxItem({ job }));
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return items;
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
