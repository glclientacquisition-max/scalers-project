/**
 * Super Admin Today: pure shaping. No data access, no `@/` imports, so tests load it directly.
 * Every number on Today comes from `calls` (and, later, call traces). Nothing here invents a metric.
 */

export const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const STUCK_SIGNUP_DAYS = 3;
export const QUIET_DAYS = 7;

export type TimeWindow = { start: string; end: string };

/** Start of the EAT calendar day that contains `now`, as a UTC instant. */
export function eatDayStart(now: Date): Date {
  const local = new Date(now.getTime() + EAT_OFFSET_MS);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal - EAT_OFFSET_MS);
}

/**
 * Today so far, and the same stretch of the same weekday last week (midnight to the same clock time).
 * Comparing to a whole day last week would make every morning look like a drop.
 */
export function todayWindows(now: Date): { today: TimeWindow; lastWeek: TimeWindow } {
  const start = eatDayStart(now);
  const elapsed = Math.max(0, now.getTime() - start.getTime());
  const lastStart = new Date(start.getTime() - 7 * DAY_MS);
  return {
    today: { start: start.toISOString(), end: now.toISOString() },
    lastWeek: { start: lastStart.toISOString(), end: new Date(lastStart.getTime() + elapsed).toISOString() },
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Friday 9 Oct" in EAT. */
export function eatDayLabel(now: Date): string {
  const local = new Date(now.getTime() + EAT_OFFSET_MS);
  return `${WEEKDAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

export type CallCount = { today: number; lastWeek: number } | null;

export type CallCounts = {
  total: CallCount;
  needsHuman: CallCount;
  abandoned: CallCount;
};

export type TodayNumberRow = {
  key: string;
  title: string;
  value: string;
  detail: string;
  /** False when the data does not exist yet. The row says why instead of showing a number. */
  available: boolean;
};

function compareLine(count: { today: number; lastWeek: number }, weekday: string): string {
  return `Last ${weekday} by now: ${count.lastWeek}`;
}

/**
 * Today in numbers. `couldntAnswer` stays a gap until the call-quality reader is on main.
 */
export function todayNumberRows(counts: CallCounts, now: Date): TodayNumberRow[] {
  const weekday = WEEKDAYS[new Date(now.getTime() + EAT_OFFSET_MS).getUTCDay()];
  const row = (key: string, title: string, count: CallCount, missing: string): TodayNumberRow =>
    count
      ? { key, title, value: String(count.today), detail: compareLine(count, weekday), available: true }
      : { key, title, value: "", detail: missing, available: false };
  return [
    row("calls", "Calls today", counts.total, "Could not count calls."),
    row("needs-human", "Needed a person", counts.needsHuman, "Call outcomes are not recorded here yet."),
    row("abandoned", "Caller hung up early", counts.abandoned, "Call outcomes are not recorded here yet."),
    {
      key: "couldnt-answer",
      title: "Couldn't answer",
      value: "",
      detail: "Arrives with call quality.",
      available: false,
    },
  ];
}

export type StatusSignal = { active: boolean; critical: boolean; title: string };

/** One sentence for the top of Today. Names what is wrong; never a supplier or host. */
export function statusSentence(signals: StatusSignal[]): { tone: "ok" | "attention" | "down"; text: string } {
  const active = signals.filter((s) => s.active);
  const critical = active.filter((s) => s.critical);
  const names = (list: StatusSignal[]) => {
    const titles = list.map((s) => s.title);
    if (titles.length <= 2) return titles.join(" and ");
    return `${titles.slice(0, 2).join(", ")} and ${titles.length - 2} more`;
  };
  if (critical.length) {
    return { tone: "down", text: `${names(critical)} ${critical.length === 1 ? "is" : "are"} down` };
  }
  if (active.length) {
    return { tone: "attention", text: `${names(active)} ${active.length === 1 ? "needs" : "need"} a look` };
  }
  return { tone: "ok", text: "All systems normal" };
}

export type TodayQueueRow = { key: string; title: string; detail: string; href: string; stamp: string };

export type TodayBusiness = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  packageName: string | null;
};

function daysSince(iso: string, now: Date): number {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return 0;
  return Math.floor((now.getTime() - at) / DAY_MS);
}

/** Live, on a package, and old enough that a silent week means something. */
export function quietCandidates(businesses: TodayBusiness[], now: Date): string[] {
  return businesses
    .filter((b) => b.status === "active" && Boolean(b.packageName) && daysSince(b.createdAt, now) >= QUIET_DAYS)
    .map((b) => b.id);
}

/**
 * Needs you, worst first: open platform notices, then businesses waiting for a number
 * (oldest first, with how long), live with no package, then live but quiet for 7 days.
 * `callingBusinessIds` holds the quiet candidates that did take a call in the last 7 days; null when unknown,
 * so nothing gets flagged as quiet on a failed read.
 */
export function todayQueue(input: {
  noticeRows: TodayQueueRow[];
  businesses: TodayBusiness[];
  callingBusinessIds: Set<string> | null;
  now: Date;
}): TodayQueueRow[] {
  const { now } = input;
  const href = (id: string) => `/admin/businesses#biz-${id}`;
  const rows: TodayQueueRow[] = [...input.noticeRows];

  const waiting = input.businesses
    .filter((b) => b.status === "waiting")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const b of waiting) {
    const days = daysSince(b.createdAt, now);
    const stuck = days >= STUCK_SIGNUP_DAYS;
    rows.push({
      key: `biz-${b.id}`,
      title: b.name,
      detail: stuck ? `Waiting for a number for ${days} days` : "Waiting for a number",
      href: href(b.id),
      stamp: stuck ? "Stuck" : "Waiting",
    });
  }

  for (const b of input.businesses) {
    if (b.status !== "active" || b.packageName) continue;
    rows.push({ key: `biz-${b.id}`, title: b.name, detail: "Live with no package", href: href(b.id), stamp: "Package" });
  }

  if (input.callingBusinessIds) {
    const candidates = new Set(quietCandidates(input.businesses, now));
    for (const b of input.businesses) {
      if (!candidates.has(b.id) || input.callingBusinessIds.has(b.id)) continue;
      rows.push({
        key: `quiet-${b.id}`,
        title: b.name,
        detail: `Live, no calls in ${QUIET_DAYS} days`,
        href: href(b.id),
        stamp: "Quiet",
      });
    }
  }
  return rows;
}
