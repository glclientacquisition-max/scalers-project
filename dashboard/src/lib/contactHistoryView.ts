import { formatCallWhen } from "@/lib/callsTriage";
import type { InboxPurpose } from "@/lib/inboxPurpose";
import { purposeLabel } from "@/lib/inboxPurpose";
import type { ContactTimelineEntry } from "@/lib/contactPersonFile";

/** Consecutive same-purpose rows inside this window collapse. Easy to tune. */
export const CONTACT_HISTORY_GROUP_MS = 15 * 60 * 1000;

export type ContactHistoryFilter =
  | "all"
  | "missed"
  | "human"
  | "job"
  | "answered";

export type ContactHistoryChip = {
  id: ContactHistoryFilter;
  label: string;
};

export type ContactHistoryGroup = {
  id: string;
  purpose: InboxPurpose;
  stamp: string;
  entries: ContactTimelineEntry[];
  startAt: string;
  endAt: string;
};

export type ContactHistoryRow =
  | { kind: "single"; entry: ContactTimelineEntry }
  | { kind: "group"; group: ContactHistoryGroup };

export function resolveContactHistoryFilter(
  raw?: string | null
): ContactHistoryFilter {
  const value = String(raw || "all").toLowerCase();
  if (
    value === "missed" ||
    value === "human" ||
    value === "job" ||
    value === "answered"
  ) {
    return value;
  }
  return "all";
}

export function contactHistoryChips(): ContactHistoryChip[] {
  return [
    { id: "all", label: "All" },
    { id: "missed", label: purposeLabel("missed") },
    { id: "human", label: purposeLabel("human") },
    { id: "job", label: "Visits" },
    { id: "answered", label: purposeLabel("answered") },
  ];
}

export function contactHistoryMatchesQuery(
  entry: ContactTimelineEntry,
  q: string
): boolean {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return true;
  const when = formatCallWhen(entry.createdAt).toLowerCase();
  const hay = [entry.headline, entry.detail, entry.stamp, entry.status, when]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(text);
}

export function filterContactTimeline(
  entries: ContactTimelineEntry[],
  filter: ContactHistoryFilter,
  q = ""
): ContactTimelineEntry[] {
  return entries.filter((entry) => {
    if (filter !== "all" && entry.purpose !== filter) return false;
    return contactHistoryMatchesQuery(entry, q);
  });
}

function minutesBetween(a: string, b: string): number {
  const start = Date.parse(a);
  const end = Date.parse(b);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.abs(end - start) / 60000;
}

/** Display-time only. Different purposes never share a group. */
export function groupContactTimeline(
  entries: ContactTimelineEntry[],
  windowMs = CONTACT_HISTORY_GROUP_MS
): ContactHistoryRow[] {
  const rows: ContactHistoryRow[] = [];
  let open: ContactTimelineEntry[] = [];

  function flush() {
    if (!open.length) return;
    if (open.length === 1) {
      rows.push({ kind: "single", entry: open[0] });
    } else {
      const first = open[0];
      const last = open[open.length - 1];
      rows.push({
        kind: "group",
        group: {
          id: `group:${first.id}:${last.id}`,
          purpose: first.purpose,
          stamp: first.stamp,
          entries: open,
          startAt: last.createdAt < first.createdAt ? last.createdAt : first.createdAt,
          endAt: last.createdAt > first.createdAt ? last.createdAt : first.createdAt,
        },
      });
    }
    open = [];
  }

  for (const entry of entries) {
    const prev = open[open.length - 1];
    if (
      prev &&
      prev.purpose === entry.purpose &&
      Math.abs(Date.parse(prev.createdAt) - Date.parse(entry.createdAt)) <= windowMs
    ) {
      open.push(entry);
      continue;
    }
    flush();
    open = [entry];
  }
  flush();
  return rows;
}

export function contactHistoryGroupCopy(group: ContactHistoryGroup): string {
  const minutes = Math.max(1, Math.round(minutesBetween(group.startAt, group.endAt)));
  const noun =
    group.purpose === "missed"
      ? "missed calls"
      : group.purpose === "job"
        ? "visits"
        : group.purpose === "human"
          ? "human asks"
          : group.purpose === "answered"
            ? "answered calls"
            : "rows";
  return `${group.entries.length} ${noun} in a ${minutes}-minute window`;
}

function nairobiDayKey(iso: string): string | null {
  if (!Number.isFinite(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function contactHistoryDailyCounts(
  entries: ContactTimelineEntry[],
  days = 21,
  now = new Date()
): Array<{ day: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = nairobiDayKey(entry.createdAt);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out: Array<{ day: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const stamp = new Date(now.getTime() - i * 86400000);
    const key = nairobiDayKey(stamp.toISOString());
    if (!key) continue;
    out.push({ day: key, count: counts.get(key) || 0 });
  }
  return out;
}

/** Real ratio from this contact's History. No wallpaper copy. */
export function contactHistoryInsight(
  entries: ContactTimelineEntry[]
): string | null {
  const total = entries.length;
  if (total < 8) return null;
  const missed = entries.filter((entry) => entry.purpose === "missed").length;
  if (missed / total < 0.55) return null;
  return `${missed} of ${total} interactions are missed. Same-day retries may need a callback.`;
}

export function lastReasonIsHistoryDuplicate(
  lastReason: string | null | undefined,
  latest: ContactTimelineEntry | undefined
): boolean {
  const reason = String(lastReason || "").trim().toLowerCase();
  if (!reason || !latest) return false;
  const card = latest.ownerCard;
  if (card && (card.done || card.mood || card.next)) return false;
  const headline = String(latest.headline || "").trim().toLowerCase();
  const want = String(latest.ownerWant || latest.ownerReason || "").trim().toLowerCase();
  return reason === headline || reason === want;
}
