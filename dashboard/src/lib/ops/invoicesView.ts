/**
 * Invoices (ADMIN_V2): pure shaping. No data access, no `@/` imports, so tests load it directly.
 * Overdue is not a stored status: an open invoice past its due date with a balance left.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EAT_MS = 3 * 60 * 60 * 1000;

export type InvoiceLine = { description: string; amountCents: number };
export type InvoiceRow = {
  id: string;
  number: string;
  businessId: string;
  businessName: string;
  status: string;
  totalCents: number;
  paidCents: number;
  dueAt: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  lines: InvoiceLine[];
  /** Saved billing contact (tenants.alert_email). */
  billingEmail?: string | null;
  /** Dispute: due-soon / overdue notices paused when set. */
  remindersPausedAt?: string | null;
};

export type InvoiceView = "overdue" | "issued" | "draft" | "paid" | "void" | "all";
export const INVOICE_VIEWS: { id: InvoiceView; label: string }[] = [
  { id: "overdue", label: "Overdue" },
  { id: "issued", label: "Issued" },
  { id: "draft", label: "Draft" },
  { id: "paid", label: "Paid" },
  { id: "void", label: "Void" },
  { id: "all", label: "All" },
];

export function balanceCents(r: InvoiceRow): number {
  return Math.max(0, r.totalCents - r.paidCents);
}

export function isOverdue(r: InvoiceRow, now: Date): boolean {
  return r.status === "open" && !!r.dueAt && new Date(r.dueAt).getTime() < now.getTime() && balanceCents(r) > 0;
}

export function daysOverdue(r: InvoiceRow, now: Date): number {
  if (!isOverdue(r, now)) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(r.dueAt as string).getTime()) / DAY_MS));
}

export function displayStatus(r: InvoiceRow, now: Date): string {
  if (isOverdue(r, now)) return "Overdue";
  if (r.status === "open") return "Issued";
  if (r.status === "uncollectible") return "Void (uncollectible)";
  if (r.status === "draft") return "Draft";
  if (r.status === "paid") return "Paid";
  if (r.status === "void") return "Void";
  return r.status || "Unknown";
}

export function statusTone(r: InvoiceRow, now: Date): "ok" | "info" | "warn" | "danger" | "neutral" {
  if (isOverdue(r, now)) return "danger";
  if (r.status === "open") return "info";
  if (r.status === "paid") return "ok";
  if (r.status === "draft") return "warn";
  return "neutral";
}

export function inInvoiceView(r: InvoiceRow, v: InvoiceView, now: Date): boolean {
  switch (v) {
    case "overdue": return isOverdue(r, now);
    case "issued": return r.status === "open" && !isOverdue(r, now);
    case "draft": return r.status === "draft";
    case "paid": return r.status === "paid";
    case "void": return r.status === "void" || r.status === "uncollectible";
    default: return true;
  }
}

export function invoiceCounts(rows: InvoiceRow[], now: Date): Record<InvoiceView, number> {
  const out = { overdue: 0, issued: 0, draft: 0, paid: 0, void: 0, all: rows.length };
  for (const r of rows) for (const v of INVOICE_VIEWS) if (v.id !== "all" && inInvoiceView(r, v.id, now)) out[v.id] += 1;
  return out;
}

/** Opens on Overdue when it has rows, else All. */
export function defaultInvoiceView(rows: InvoiceRow[], now: Date): InvoiceView {
  return rows.some((r) => isOverdue(r, now)) ? "overdue" : "all";
}

/** Totals for the rows in view. Void and draft add nothing to what is owed. */
export function invoiceTotals(rows: InvoiceRow[]): { total: number; paid: number; balance: number } {
  let total = 0, paid = 0, balance = 0;
  for (const r of rows) {
    if (r.status === "void" || r.status === "uncollectible" || r.status === "draft") continue;
    total += r.totalCents;
    paid += r.paidCents;
    balance += balanceCents(r);
  }
  return { total, paid, balance };
}

export function matchesInvoice(r: InvoiceRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return r.number.toLowerCase().includes(s) || r.businessName.toLowerCase().includes(s);
}

export function ksh(cents: number): string {
  const v = Math.round(cents) / 100;
  return `KSh ${v.toLocaleString("en-KE", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** YYYY-MM-DD in EAT. */
export function eatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + EAT_MS).toISOString().slice(0, 10);
}

function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV of the rows in view: dates in EAT, amounts in KSh with two decimals. */
export function invoicesCsv(rows: InvoiceRow[], now: Date): string {
  const head = ["Number", "Business", "Status", "Period start", "Period end", "Issued", "Due", "Days overdue", "Total KSh", "Paid KSh", "Balance KSh"];
  const kes = (c: number) => (Math.round(c) / 100).toFixed(2);
  const body = rows.map((r) => [
    r.number, r.businessName, displayStatus(r, now), eatDate(r.periodStart), eatDate(r.periodEnd), eatDate(r.issuedAt), eatDate(r.dueAt),
    String(daysOverdue(r, now)), kes(r.totalCents), kes(r.paidCents), kes(balanceCents(r)),
  ].map(cell).join(","));
  return [head.join(","), ...body].join("\n") + "\n";
}
