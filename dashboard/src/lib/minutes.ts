/**
 * Call minutes from metered seconds (`seconds_used`, the counter billing and the
 * minute cap read). A started minute counts as used. Every owner screen that
 * shows minutes goes through here so Plan, Usage, Home, and trial agree.
 */
export function minutesUsedFromSeconds(seconds: unknown): number {
  const n = Number(seconds);
  return Math.ceil(Math.max(0, Number.isFinite(n) ? n : 0) / 60);
}

export function minutesLeft(included: unknown, seconds: unknown): number {
  const n = Number(included);
  return Math.max(0, Math.floor(Number.isFinite(n) ? n : 0) - minutesUsedFromSeconds(seconds));
}
