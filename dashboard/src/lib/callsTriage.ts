import { followUpWhatsAppText, summaryTopic } from "./ownerTopic";
import { pickCallOwnerReason } from "@/lib/callSummarySentence";
import { applyOwnerFacts, type OwnerFacts } from "@/lib/ownerCallFacts";
import {
  leadStatusLabel,
  parseCallResolution,
  parseLeadStatus,
  parseSummary,
  type CallResolution,
  type CallRow,
  type LeadStatus,
} from "@/lib/supabase";

export type Lead = {
  call: CallRow;
  name: string | null;
  reason: string | null;
  notified: boolean;
  urgent: boolean;
  leadStatus: LeadStatus;
  resolution: CallResolution;
  primaryIntent: string | null;
  /** summary.topic (or owner_review.topic) from Brain. Null when null or missing; never built from the reason. */
  topic?: string | null;
  /** Owner's corrected Wanted / Result labels, when they fixed this call. */
  ownerWanted?: string | null;
  ownerResult?: string | null;
};

export const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "contacted", label: "Followed Up" },
  { id: "resolved", label: "Done" },
  { id: "archived", label: "Archived" },
] as const;

export type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];

export { leadStatusLabel };

export function toLead(call: CallRow, facts?: OwnerFacts | null): Lead {
  const meta = parseSummary(call.summary);
  const owned = applyOwnerFacts(
    { primaryIntent: call.primary_intent?.trim() || null, resolution: parseCallResolution(call.resolution) },
    facts,
  );
  return {
    call,
    name: typeof meta.name === "string" ? meta.name : null,
    reason: pickCallOwnerReason(meta),
    topic: summaryTopic(meta),
    notified: Boolean(meta.owner_notified || meta.whatsapp_sent),
    urgent: String(call.sentiment || "").toLowerCase() === "urgent",
    leadStatus: parseLeadStatus(call.lead_status),
    resolution: owned.resolution as CallResolution,
    primaryIntent: owned.primaryIntent,
    ownerWanted: owned.wanted,
    ownerResult: owned.result,
  };
}

export function formatCallWhen(iso: string, style: "short" | "full" = "short") {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      dateStyle: style === "full" ? "full" : "medium",
      timeStyle: style === "full" ? "medium" : "short",
      timeZone: "Africa/Nairobi",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function nairobiDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function nairobiTime(iso: string): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/\s?(am|pm)$/i, (_, mer) => ` ${mer.toUpperCase()}`);
}

/** Inbox When column for real ISO datetimes. Free-text slots stay unformatted. */
export function formatCallWhenRelative(iso: string, now = new Date()): string {
  try {
    const time = nairobiTime(iso);
    const thenDay = nairobiDayKey(new Date(iso));
    const today = nairobiDayKey(now);
    if (thenDay === today) return `at ${time}`;

    const [ty, tm, td] = today.split("-").map(Number);
    const [yy, ym, yd] = thenDay.split("-").map(Number);
    const diffDays = Math.round(
      (Date.UTC(ty, tm - 1, td) - Date.UTC(yy, ym - 1, yd)) / 86400000
    );
    if (diffDays === -1) return `Tomorrow, ${time}`;
    if (Math.abs(diffDays) < 7) {
      const weekday = new Intl.DateTimeFormat("en-KE", {
        timeZone: "Africa/Nairobi",
        weekday: "short",
      }).format(new Date(iso));
      return `${weekday}, ${time}`;
    }
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Nairobi",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
    return `${date}, ${time}`;
  } catch {
    return iso;
  }
}

export function nairobiDayStartIso(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(new Date());
  return new Date(`${day}T00:00:00+03:00`).toISOString();
}

/** Nairobi calendar day for Home. Real date, not decorative copy. */
export function nairobiDateLabel(now = new Date()): { iso: string; label: string } {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  try {
    return {
      iso,
      label: new Intl.DateTimeFormat("en-KE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Africa/Nairobi",
      }).format(now),
    };
  } catch {
    return { iso, label: iso };
  }
}

/** Explicit status wins; bare /calls defaults to New when work is waiting. */
export function resolveStatusFilter(
  raw: string | undefined,
  newCount: number
): StatusFilterId {
  if (raw === "all") return "all";
  if (
    raw === "new" ||
    raw === "contacted" ||
    raw === "resolved" ||
    raw === "archived"
  ) {
    return raw;
  }
  return newCount > 0 ? "new" : "all";
}

export function callsHref(opts: {
  purpose?: string;
  status?: StatusFilterId;
  page?: number;
  q?: string;
  view?: string;
  week?: string;
  day?: string;
} = {}): string {
  const q = new URLSearchParams();
  if (opts.purpose) q.set("purpose", opts.purpose);
  else if (opts.status) q.set("status", opts.status);
  if (opts.q?.trim()) q.set("q", opts.q.trim());
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  if (opts.view) q.set("view", opts.view);
  if (opts.week) q.set("week", opts.week);
  if (opts.day) q.set("day", opts.day);
  const qs = q.toString();
  return qs ? `/calls?${qs}` : "/calls";
}

export function sanitizeSearchQuery(raw: string | undefined): string {
  return String(raw || "")
    .trim()
    .slice(0, 64)
    .replace(/[%_,.()]/g, " ");
}

/**
 * Prefilled WhatsApp opener for Kenyan SME follow-up. Uses summary.topic only
 * (Brain #751 contract); the reason sentence is never pasted in.
 */
export function followUpWhatsAppMessage(opts: {
  businessName: string;
  name: string | null;
  topic: string | null | undefined;
}): string {
  return followUpWhatsAppText(opts);
}

