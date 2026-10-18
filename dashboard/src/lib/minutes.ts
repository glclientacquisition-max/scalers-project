/**
 * Call minutes from metered seconds (`seconds_used`, the counter billing debits
 * per second and the minute cap reads). Billing is per second, so a minute
 * shows as used only once all 60 seconds are used: owner screens never show
 * more than is billed. Every owner screen that shows minutes goes through here
 * so Plan, Usage, Home, and trial agree. Never read the view's one-decimal
 * used_minutes or remaining_minutes.
 */

function finite(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function minutesUsedFromSeconds(seconds: unknown): number {
  return Math.floor(Math.max(0, finite(seconds)) / 60);
}

export type MinuteMeter = {
  included: number;
  used: number;
  /** included minus the shown used, never below 0. Used plus left is the included minutes until overage. */
  left: number;
  /** More than 0 and fewer than 60 real seconds remain. Show "Under 1 min left", not the number. */
  underOneMinute: boolean;
  /** Seconds past the included minutes. 0 when not over or without included minutes. */
  overSeconds: number;
  /** "12 min 30 s over". Null when not over. */
  overLabel: string | null;
};

export function overLabel(overSeconds: number): string | null {
  const total = Math.floor(Math.max(0, overSeconds));
  if (total <= 0) return null;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0 && s > 0) return `${m} min ${s} s over`;
  return m > 0 ? `${m} min over` : `${s} s over`;
}

export function minuteMeter(included: unknown, seconds: unknown): MinuteMeter {
  const inc = Math.max(0, Math.floor(finite(included)));
  const secs = Math.max(0, finite(seconds));
  const used = minutesUsedFromSeconds(secs);
  const remaining = inc * 60 - secs;
  const left = remaining <= 0 ? 0 : Math.max(0, inc - used);
  const overSeconds = inc > 0 && remaining < 0 ? -remaining : 0;
  return {
    included: inc,
    used,
    left,
    underOneMinute: inc > 0 && remaining > 0 && remaining < 60,
    overSeconds,
    overLabel: overLabel(overSeconds),
  };
}

export function minutesLeft(included: unknown, seconds: unknown): number {
  return minuteMeter(included, seconds).left;
}

/** "Under 1 min left" or "800 min left". */
export function minutesLeftLabel(meter: Pick<MinuteMeter, "left" | "underOneMinute">): string {
  return meter.underOneMinute ? "Under 1 min left" : `${meter.left.toLocaleString("en-KE")} min left`;
}
