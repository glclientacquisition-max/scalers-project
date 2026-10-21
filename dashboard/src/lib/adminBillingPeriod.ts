/** "31 Oct" in Nairobi time from the exclusive period end. */
function periodEndLabel(periodEnd: string | null | undefined): string | null {
  if (!periodEnd) return null;
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(end)) return null;
  const last = new Date(end - 1000);
  return last.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
}

/** Period ends within this many ms (7 days). */
export const ROLLOVER_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export function invoiceOverdue(dueAt: string | null | undefined, status: string, now = Date.now()): boolean {
  const name = String(status || "").toLowerCase();
  if (name !== "open") return false;
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  return Number.isFinite(due) && due < now;
}

export function periodEndWithinRolloverWindow(periodEnd: string | null | undefined, now = Date.now()): boolean {
  if (!periodEnd) return false;
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(end)) return false;
  return end > now && end - now <= ROLLOVER_SOON_MS;
}

export function earliestPeriodEndLabel(rows: { periodEnd: string | null }[], now = Date.now()): string | null {
  let best: number | null = null;
  for (const row of rows) {
    if (!row.periodEnd) continue;
    const end = Date.parse(row.periodEnd);
    if (!Number.isFinite(end) || end <= now) continue;
    if (best == null || end < best) best = end;
  }
  return best == null ? null : periodEndLabel(new Date(best).toISOString());
}
