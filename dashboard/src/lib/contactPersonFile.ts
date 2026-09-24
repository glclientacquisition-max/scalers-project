import { inboxRecordHref } from "@/lib/inboxHref";
import {
  buildInboxItem,
  itemSignalLabel,
  type InboxHold,
  type InboxItem,
  type InboxJob,
  type InboxPurpose,
} from "@/lib/inboxPurpose";
import type { Lead } from "@/lib/callsTriage";

export type ContactTimelineEntry = {
  id: string;
  kind: "call" | "request" | "appointment";
  createdAt: string;
  headline: string;
  detail: string | null;
  callId: string | null;
  href: string | null;
  status: string | null;
  jobStatus: string | null;
  stamp: string;
  purpose: InboxPurpose;
  ownerReason?: string | null;
  ownerWant?: string | null;
  ownerCard?: {
    want: string | null;
    done: string | null;
    mood: string | null;
    next: string | null;
  } | null;
};

export type ContactPersonKpiId = "interactions" | "visitsDone" | "customerSince";

export type ContactPersonKpiCard = {
  id: ContactPersonKpiId;
  label: string;
  value: string;
};

export type ContactCallMeta = {
  ownerReason: string | null;
  ownerWant: string | null;
  ownerCard: ContactTimelineEntry["ownerCard"];
};

function nairobiYearMonth(d: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

/** Earliest real ISO stamp. Skip empty and unparsable values. */
export function pickFirstSeenAt(
  ...stamps: Array<string | null | undefined>
): string | null {
  let earliest: string | null = null;
  for (const stamp of stamps) {
    const iso = String(stamp || "").trim();
    if (!iso) continue;
    if (!Number.isFinite(Date.parse(iso))) continue;
    if (!earliest || iso < earliest) earliest = iso;
  }
  return earliest;
}

/** Whole Nairobi calendar months from a stored stamp. Null when the stamp is missing. */
export function customerSinceMonths(
  iso?: string | null,
  now = new Date()
): number | null {
  const raw = String(iso || "").trim();
  if (!raw) return null;
  const then = new Date(raw);
  if (Number.isNaN(then.getTime())) return null;
  const a = nairobiYearMonth(then);
  const b = nairobiYearMonth(now);
  if (!a.year || !a.month || !b.year || !b.month) return null;
  const months = (b.year - a.year) * 12 + (b.month - a.month);
  return months < 0 ? 0 : months;
}

/** Cards with a source only. Empty count or missing stamp is omitted. */
export function contactPersonFileKpiCards(opts: {
  interactionCount: number;
  visitsDoneCount: number;
  firstSeenAt: string | null;
  now?: Date;
}): ContactPersonKpiCard[] {
  const cards: ContactPersonKpiCard[] = [];
  if (opts.interactionCount > 0) {
    cards.push({
      id: "interactions",
      label: "Interactions",
      value: String(opts.interactionCount),
    });
  }
  if (opts.visitsDoneCount > 0) {
    cards.push({
      id: "visitsDone",
      label: "Visits done",
      value: String(opts.visitsDoneCount),
    });
  }
  const months = customerSinceMonths(opts.firstSeenAt, opts.now);
  if (months != null && months > 0) {
    cards.push({
      id: "customerSince",
      label: "Customer since",
      value: `${months} mo`,
    });
  }
  return cards;
}

function historyId(item: InboxItem): string {
  if (item.job) return `appointment:${item.job.id}`;
  if (item.hold) return `request:${item.hold.id}`;
  return `call:${item.callId || item.id}`;
}

function historyKind(item: InboxItem): ContactTimelineEntry["kind"] {
  if (item.job) return "appointment";
  if (item.hold) return "request";
  return "call";
}

/** One History row per Inbox ticket. Stamp is the Inbox signal, not a CRM type. */
export function contactHistoryEntries(opts: {
  leads: Lead[];
  holds: InboxHold[];
  jobs: InboxJob[];
  callMetaById?: Record<string, ContactCallMeta>;
  vertical?: string | null;
}): ContactTimelineEntry[] {
  const vertical = opts.vertical || null;
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
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items.map((item) => {
    const meta = (item.callId && opts.callMetaById?.[item.callId]) || {
      ownerReason: null,
      ownerWant: null,
      ownerCard: null,
    };
    return {
      id: historyId(item),
      kind: historyKind(item),
      createdAt: item.createdAt,
      headline: item.headline,
      detail: item.detail,
      callId: item.callId,
      href: item.callId ? inboxRecordHref(item.callId) : null,
      status: item.job?.status || item.hold?.status || item.lead?.call.status || null,
      jobStatus: item.job?.status || null,
      stamp: itemSignalLabel(item, opts.vertical),
      purpose: item.purpose,
      ownerReason: meta.ownerReason,
      ownerWant: meta.ownerWant,
      ownerCard: meta.ownerCard,
    };
  });
}
