import type { InvoiceRow } from "@/lib/ops/invoicesView";

/**
 * Billing home (ADMIN_V2): pure shaping, no data access. Type-only imports so tests load it directly;
 * balance and overdue follow invoicesView exactly (open, past due, balance left).
 */
const DAY_MS = 86400000;
const balanceCents = (r: InvoiceRow) => Math.max(0, r.totalCents - r.paidCents);
const isOverdue = (r: InvoiceRow, now: Date) =>
  r.status === "open" && !!r.dueAt && new Date(r.dueAt).getTime() < now.getTime() && balanceCents(r) > 0;
const daysOverdue = (r: InvoiceRow, now: Date) =>
  isOverdue(r, now) ? Math.max(0, Math.floor((now.getTime() - new Date(r.dueAt as string).getTime()) / DAY_MS)) : 0;

/** One business on Billing home: what it owes now and how late the oldest unpaid invoice is. */
export type OwingBusiness = {
  businessId: string;
  businessName: string;
  balanceCents: number;
  overdueCents: number;
  openCount: number;
  oldestLateDays: number;
  invoices: InvoiceRow[];
};

export type BillingHomeTotals = {
  billedThisMonthCents: number;
  collectedThisMonthCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
};

const counts = (r: InvoiceRow) => r.status !== "void" && r.status !== "uncollectible" && r.status !== "draft";
/** First day of `now`'s month in Nairobi, as UTC ms. */
export function nairobiMonthStart(now: Date): number {
  const eat = new Date(now.getTime() + 3 * 3600000);
  return Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), 1) - 3 * 3600000;
}

/** Paid amounts this Nairobi month, one point per week that has a payment. Empty when fewer than two weeks paid. */
export function collectedWeekPoints(rows: InvoiceRow[], now: Date): { label: string; value: number }[] {
  const start = nairobiMonthStart(now);
  const fmt = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
  const byWeek = new Map<number, number>();
  for (const r of rows) {
    if (!counts(r) || !r.paidAt) continue;
    const t = Date.parse(r.paidAt);
    if (!Number.isFinite(t) || t < start || t > now.getTime()) continue;
    const week = Math.floor((t - start) / (7 * 86400000));
    byWeek.set(week, (byWeek.get(week) || 0) + r.paidCents);
  }
  const points = [...byWeek.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(([week, value]) => ({ label: fmt.format(new Date(start + week * 7 * 86400000)), value }));
  return points.length >= 2 ? points : [];
}

/** Collected last calendar month in Nairobi. Null when that month has no payments. */
export function lastMonthCollected(rows: InvoiceRow[], now: Date): { cents: number; label: string } | null {
  const start = nairobiMonthStart(now);
  const eat = new Date(start + 3 * 3600000);
  const prevStart = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() - 1, 1) - 3 * 3600000;
  let cents = 0;
  let n = 0;
  for (const r of rows) {
    if (!counts(r) || !r.paidAt) continue;
    const t = Date.parse(r.paidAt);
    if (t >= prevStart && t < start) {
      cents += r.paidCents;
      n += 1;
    }
  }
  if (n === 0) return null;
  const label = new Intl.DateTimeFormat("en-KE", { month: "long", timeZone: "Africa/Nairobi" }).format(new Date(prevStart + 3 * 3600000));
  return { cents, label };
}

export type OverdueAging = { to7: number; to30: number; over30: number };

/** Overdue balance in cents by age. All zeros means nothing is overdue. */
export function overdueAging(rows: InvoiceRow[], now: Date): OverdueAging {
  const aging: OverdueAging = { to7: 0, to30: 0, over30: 0 };
  for (const r of rows) {
    if (!isOverdue(r, now)) continue;
    const days = daysOverdue(r, now);
    const cents = balanceCents(r);
    if (days <= 7) aging.to7 += cents;
    else if (days <= 30) aging.to30 += cents;
    else aging.over30 += cents;
  }
  return aging;
}

export function billingHomeTotals(rows: InvoiceRow[], now: Date): BillingHomeTotals {
  const start = nairobiMonthStart(now);
  const t: BillingHomeTotals = { billedThisMonthCents: 0, collectedThisMonthCents: 0, outstandingCents: 0, overdueCents: 0, overdueCount: 0 };
  for (const r of rows) {
    if (!counts(r)) continue;
    if (r.issuedAt && Date.parse(r.issuedAt) >= start) t.billedThisMonthCents += r.totalCents;
    if (r.paidAt && Date.parse(r.paidAt) >= start) t.collectedThisMonthCents += r.paidCents;
    t.outstandingCents += balanceCents(r);
    if (isOverdue(r, now)) { t.overdueCents += balanceCents(r); t.overdueCount += 1; }
  }
  return t;
}

/** Businesses with a balance, latest-paying last: most days late first, then largest balance. */
export function owingBusinesses(rows: InvoiceRow[], now: Date): OwingBusiness[] {
  const by = new Map<string, OwingBusiness>();
  for (const r of rows) {
    if (!counts(r) || balanceCents(r) <= 0) continue;
    const b = by.get(r.businessId) ?? { businessId: r.businessId, businessName: r.businessName, balanceCents: 0, overdueCents: 0, openCount: 0, oldestLateDays: 0, invoices: [] };
    b.balanceCents += balanceCents(r);
    b.openCount += 1;
    b.invoices.push(r);
    if (isOverdue(r, now)) b.overdueCents += balanceCents(r);
    b.oldestLateDays = Math.max(b.oldestLateDays, daysOverdue(r, now));
    by.set(r.businessId, b);
  }
  return [...by.values()].sort((a, b) => b.oldestLateDays - a.oldestLateDays || b.balanceCents - a.balanceCents);
}
