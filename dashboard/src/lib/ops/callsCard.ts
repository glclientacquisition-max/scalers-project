import { outcomeCounts, weekCounts, type FactRow, type WeekCount } from "./insightsView";

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
      weeks: WeekCount[];
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
    weeks: weekCounts(current, days, nowMs).toReversed(),
    split: callsSplit(current),
    priorCalls: prior.length > 0 ? prior.length : null,
  };
}
