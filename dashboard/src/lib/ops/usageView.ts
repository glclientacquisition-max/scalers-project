/**
 * Per-business usage drill-down (ADMIN_V2): minutes by day against the package. Pure, no I/O.
 * Minutes come from call durations by day; the period total comes from the meter (seconds_used).
 * No prices are computed here: on-demand KSh is only what billing already recorded.
 */

export type UsageCall = { id: string; createdAt: string; durationSeconds: number; resolution: string | null; intent: string | null };

export type UsageInput = {
  businessName: string;
  packageName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  includedMinutes: number;
  /** Meter for the current period (tenants.seconds_used / tenant_billing_state.used_seconds). */
  meteredSeconds: number;
  onDemandEnabled: boolean;
  /** Recorded by billing (tenant_billing_state.overage_owed_kes). Null when not recorded. */
  onDemandOwedKes: number | null;
  calls: UsageCall[];
};

export type UsageDay = {
  date: string; // YYYY-MM-DD in EAT
  calls: number;
  seconds: number;
  runningSeconds: number;
  /** Running total passed the included minutes on this day. */
  crossedIncluded: boolean;
  overIncluded: boolean;
};

export type UsageView = {
  usedMinutes: number;
  includedMinutes: number;
  share: number | null;
  onDemandMinutes: number;
  daysTotal: number | null;
  daysElapsed: number | null;
  daysLeft: number | null;
  /** Minutes at period end at the current pace, or null without a period. */
  projectedMinutes: number | null;
  days: UsageDay[];
  peakDay: UsageDay | null;
  callSeconds: number;
};

const EAT_MS = 3 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

export function eatDay(iso: string): string {
  return new Date(new Date(iso).getTime() + EAT_MS).toISOString().slice(0, 10);
}

export function minutesOf(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60);
}

/** "12 min" or "1 h 05 min". */
export function minLabel(seconds: number): string {
  const m = minutesOf(seconds);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Every EAT day from start to min(end, now), so quiet days show as 0, not missing. */
export function periodDays(startIso: string, endIso: string, nowIso: string): string[] {
  const start = eatDay(startIso);
  const lastIso = new Date(Math.min(new Date(endIso).getTime() - 1, new Date(nowIso).getTime())).toISOString();
  const last = eatDay(lastIso);
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > 400) break;
  }
  return out;
}

export function buildUsage(input: UsageInput, nowIso: string): UsageView {
  const byDay = new Map<string, { calls: number; seconds: number }>();
  for (const c of input.calls) {
    const d = eatDay(c.createdAt);
    const cur = byDay.get(d) || { calls: 0, seconds: 0 };
    cur.calls += 1;
    cur.seconds += Math.max(0, Number(c.durationSeconds) || 0);
    byDay.set(d, cur);
  }
  const dates = input.periodStart && input.periodEnd
    ? periodDays(input.periodStart, input.periodEnd, nowIso)
    : [...byDay.keys()].toSorted();
  const includedSec = Math.max(0, input.includedMinutes) * 60;
  let running = 0;
  const days: UsageDay[] = dates.map((date) => {
    const v = byDay.get(date) || { calls: 0, seconds: 0 };
    const before = running;
    running += v.seconds;
    return {
      date,
      calls: v.calls,
      seconds: v.seconds,
      runningSeconds: running,
      crossedIncluded: includedSec > 0 && before < includedSec && running >= includedSec,
      overIncluded: includedSec > 0 && running > includedSec,
    };
  });

  const usedMinutes = minutesOf(input.meteredSeconds);
  let daysTotal: number | null = null;
  let daysElapsed: number | null = null;
  let daysLeft: number | null = null;
  let projectedMinutes: number | null = null;
  if (input.periodStart && input.periodEnd) {
    const s = Date.parse(input.periodStart);
    const e = Date.parse(input.periodEnd);
    const n = Math.min(Math.max(Date.parse(nowIso), s), e);
    daysTotal = Math.max(1, Math.round((e - s) / DAY_MS));
    daysElapsed = Math.max(1, Math.ceil((n - s) / DAY_MS));
    daysLeft = Math.max(0, Math.ceil((e - n) / DAY_MS));
    projectedMinutes = Math.round((usedMinutes / daysElapsed) * daysTotal);
  }
  const peakDay = days.reduce<UsageDay | null>((p, d) => (d.seconds > (p?.seconds ?? 0) ? d : p), null);
  return {
    usedMinutes,
    includedMinutes: input.includedMinutes,
    share: input.includedMinutes > 0 ? usedMinutes / input.includedMinutes : null,
    onDemandMinutes: Math.max(0, usedMinutes - input.includedMinutes),
    daysTotal,
    daysElapsed,
    daysLeft,
    projectedMinutes,
    days,
    peakDay,
    callSeconds: days.reduce((a, d) => a + d.seconds, 0),
  };
}

/** Plain-language pace line. Never a price. */
export function paceLine(v: UsageView, onDemandEnabled: boolean): string {
  if (!v.includedMinutes) return "No included minutes on this package.";
  if (v.projectedMinutes == null || v.daysLeft == null) return `${v.usedMinutes} of ${v.includedMinutes} min used.`;
  if (v.usedMinutes > v.includedMinutes) {
    return onDemandEnabled
      ? `${v.onDemandMinutes} min over the package, billed on demand. ${v.daysLeft} days left.`
      : `${v.onDemandMinutes} min over the package and on-demand is off. ${v.daysLeft} days left.`;
  }
  if (v.projectedMinutes > v.includedMinutes) {
    return `On pace for about ${v.projectedMinutes} min by period end, ${v.projectedMinutes - v.includedMinutes} over the package.`;
  }
  return `On pace for about ${v.projectedMinutes} min by period end, within the package.`;
}

export function callsOnDay(calls: UsageCall[], date: string): UsageCall[] {
  return calls.filter((c) => eatDay(c.createdAt) === date).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function eatTime(iso: string): string {
  return new Date(new Date(iso).getTime() + EAT_MS).toISOString().slice(11, 16);
}

export const RESOLUTION_LABEL: Record<string, string> = {
  resolved: "Resolved",
  needs_human: "Needs a person",
  abandoned: "Caller hung up",
  unresolved: "Unresolved",
  unknown: "Not recorded",
};
