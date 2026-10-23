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
