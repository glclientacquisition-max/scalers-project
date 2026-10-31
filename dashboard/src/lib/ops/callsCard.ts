import { outcomeCounts, weekCounts, type FactRow } from "./insightsView";

const DAY = 86400_000;
const DAY_LABEL = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });

export type CallsPoint = { label: string; value: number };

/** One point per Nairobi day in the window, oldest first. Empty days stay 0. */
export function dayCounts(rows: readonly FactRow[], days: number, nowMs: number): CallsPoint[] {
  const out = Array.from({ length: days }, (_, i) => {
    const ending = nowMs - (days - 1 - i) * DAY;
    return { label: DAY_LABEL.format(new Date(ending)), value: 0 };
  });
  for (const row of rows) {
    const age = Math.floor((nowMs - Date.parse(row.createdAt)) / DAY);
    if (age < 0 || age >= days) continue;
    out[days - 1 - age].value += 1;
  }
  return out;
}

export type CallsSplit = { assistant: number; handed: number; missed: number };

const ASSISTANT = new Set(["sale_or_order", "booking", "hold", "info_only"]);
const HANDED = new Set(["transferred", "callback"]);
const MISSED = new Set(["lost", "abandoned"]);

/** Reviewed outcomes grouped the way the Calls card draws them. */
export function callsSplit(rows: readonly FactRow[]): CallsSplit {
  const counts = outcomeCounts([...rows]);
  const sum = (ids: Set<string>) => counts.filter((row) => ids.has(row.id)).reduce((total, row) => total + row.calls, 0);
  return { assistant: sum(ASSISTANT), handed: sum(HANDED), missed: sum(MISSED) };
}

export type CallsCardModel =
  | { state: "error" }
  | { state: "empty"; days: 7 | 30 }
  | {
      state: "ready";
      days: 7 | 30;
      calls: number;
      /** Daily for 7d, weekly for 30d. Always at least two points when the card is ready. */
      series: CallsPoint[];
      split: CallsSplit;
      /** Null when the earlier window has no rows. Never a filled zero. */
      priorCalls: number | null;
    };

/**
 * `rows` is a read of the last `days * 2` days. The card uses the recent window.
 * Comparison appears only when the earlier window actually has rows.
 */
export function callsCardModel(rows: FactRow[] | null, days: 7 | 30, nowMs: number): CallsCardModel {
  if (!rows) return { state: "error" };
  const cut = nowMs - days * 86400_000;
  const current = rows.filter((row) => Date.parse(row.createdAt) >= cut);
  const prior = rows.filter((row) => {
    const at = Date.parse(row.createdAt);
    return at < cut && at >= cut - days * 86400_000;
  });
  if (current.length === 0) return { state: "empty", days };
  return {
    state: "ready",
    days,
    calls: current.length,
    series: days === 7 ? dayCounts(current, 7, nowMs) : weekCounts(current, days, nowMs).toReversed().map((week) => ({
      label: DAY_LABEL.format(new Date(week.ending)),
      value: week.calls,
    })),
    split: callsSplit(current),
    priorCalls: prior.length > 0 ? prior.length : null,
  };
}
