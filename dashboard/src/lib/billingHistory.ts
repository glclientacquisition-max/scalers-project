import { nairobiDay } from "./billingBanner";
import { invoicePayState } from "./invoicePayState";

/** Fields Desk reads from GET /api/billing/invoices. Money strings are already formatted. */
export type BillingHistoryInvoice = {
  id?: string;
  number?: string | null;
  status?: string;
  due_at?: string | null;
  total_due?: string;
  amount_paid?: string | null;
  balance?: string | null;
  pay_link_path?: string | null;
};

export type BillingHistoryBody = {
  invoices?: BillingHistoryInvoice[];
};

export type MappedInvoice = {
  id: string;
  number: string;
  totalLabel: string;
  statusLabel: string;
  payLabel: string | null;
  payLinkPath: string | null;
};

const PAY_REASONS = new Set([
  "This invoice cannot be paid here",
  "Pay link already issued",
  "This invoice is not open",
]);

/** M-Pesa's per-transaction cap. The pay page splits larger invoices into even parts. */
const PART_LIMIT_CENTS = 150_000 * 100;

/** Cents from "KSh 1,234.50", "KSh -1,000", or "-KSh 1,000". Null when it is not a KSh amount. */
export function kshCents(label: string | null | undefined): number | null {
  const m = /^\s*(-)?\s*(?:KSh\s*)?(-)?\s*(\d[\d,]*)(?:\.(\d{1,2}))?\s*$/i.exec(String(label ?? ""));
  if (!m) return null;
  const cents = Number(m[3].replace(/,/g, "")) * 100 + Number(((m[4] || "") + "00").slice(0, 2));
  return m[1] || m[2] ? -cents : cents;
}

function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = abs % 100;
  return `KSh ${cents < 0 ? "-" : ""}${frac ? `${whole}.${String(frac).padStart(2, "0")}` : whole}`;
}

/** Same even split as the pay page: each part at most KSh 150,000, parts sum to the total. */
export function splitParts(totalCents: number): number[] {
  if (totalCents <= 0) return [];
  if (totalCents <= PART_LIMIT_CENTS) return [totalCents];
  const count = Math.ceil(totalCents / PART_LIMIT_CENTS);
  const base = Math.floor(totalCents / count);
  let rem = totalCents % count;
  return Array.from({ length: count }, () => {
    const extra = rem > 0 ? 1 : 0;
    rem -= extra;
    return base + extra;
  });
}

/** The next unpaid part. Index is 1-based. Null when the parts are covered. */
export function nextPart(parts: number[], paidCents: number): { index: number; count: number; cents: number } | null {
  let cursor = 0;
  for (let i = 0; i < parts.length; i += 1) {
    if (paidCents < cursor + parts[i]) return { index: i + 1, count: parts.length, cents: cursor + parts[i] - paidCents };
    cursor += parts[i];
  }
  return null;
}

function openState(invoice: BillingHistoryInvoice, due: string | null) {
  const total = kshCents(invoice.total_due);
  if (total == null) return { statusLabel: due ? `Due by ${due}` : "Open", payCents: null };
  const paid = Math.max(0, kshCents(invoice.amount_paid) ?? 0);
  const balance = kshCents(invoice.balance);
  const owed = Math.min(total - paid, balance ?? Number.POSITIVE_INFINITY);
  if (owed <= 0) return { statusLabel: "Nothing due", payCents: null };
  const next = nextPart(splitParts(total), paid);
  if (next && next.count > 1 && next.index > 1) {
    return { statusLabel: `Part ${next.index - 1} of ${next.count} received`, payCents: next.cents };
  }
  if (paid > 0) return { statusLabel: `${formatCents(owed)} still due`, payCents: next ? next.cents : owed };
  return { statusLabel: due ? `Due by ${due}` : "Open", payCents: next ? next.cents : owed };
}

export function mapBillingHistory(
  body: BillingHistoryBody | null | undefined,
  options: { fromPay: boolean; beta?: boolean },
): MappedInvoice[] {
  const beta = Boolean(options.beta);
  const rows = (body?.invoices || []).flatMap((invoice) => {
    const id = invoice.id ? String(invoice.id) : "";
    if (!id) return [];
    const status = String(invoice.status || "");
    const pay = invoicePayState({
      status,
      payLinkPath: beta ? null : invoice.pay_link_path,
      returnedFromPay: options.fromPay && status === "open",
      beta,
    });
    if (pay.hidden) return [];
    const total = invoice.total_due || "";
    const open = pay.label === "Open" ? openState(invoice, nairobiDay(invoice.due_at)) : null;
    const payCents = pay.showPayButton ? (open?.payCents ?? null) : null;
    const row: MappedInvoice = {
      id,
      number: invoice.number || "Invoice",
      totalLabel: total,
      statusLabel: open ? open.statusLabel : pay.label || (status === "void" ? "Void" : "Closed"),
      payLabel: payCents != null ? `Pay ${formatCents(payCents)}` : null,
      payLinkPath: payCents != null ? pay.payLinkPath : null,
    };
    return [{ row, owed: open?.payCents != null }];
  });
  // Invoices with money owed first, then the rest in the order the API sent them.
  return rows
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => Number(b.owed) - Number(a.owed) || a.index - b.index)
    .map((item) => item.row);
}

/** Error codes a 503 carries when invoice payments are switched off (the Bachs safety gate). */
const PAYMENTS_OFF_CODES = new Set(["payments_unavailable", "unavailable"]);

/** One calm line for the Billing list while payments are switched off. */
export const INVOICES_UNAVAILABLE_LINE = "Invoices aren't available right now.";

/**
 * What the Billing list shows for a GET /api/billing/invoices response.
 * 404 means the invoice routes are not deployed yet, which reads as no invoices.
 * 503 with payments_unavailable means payments are switched off: one calm line, no Retry.
 * Other failures (5xx, auth, network) keep the error and Retry.
 */
export function invoiceLoadOutcome(
  status: number | null,
  body?: { error?: unknown; code?: unknown } | null,
): "list" | "empty" | "unavailable" | "error" {
  if (status == null) return "error";
  if (status >= 200 && status < 300) return "list";
  if (status === 404) return "empty";
  if (status === 503) {
    const code = body ? String(body.code ?? body.error ?? "") : "";
    if (PAYMENTS_OFF_CODES.has(code)) return "unavailable";
  }
  return "error";
}

/** Redirect only to the one-time path the pay-link POST returns. */
export function payLinkDestination(body: { pay_path?: unknown; reason?: unknown } | null): {
  href?: string;
  reason: string;
} {
  const path = body && typeof body.pay_path === "string" ? body.pay_path : "";
  if (path.startsWith("/pay/") && !path.startsWith("//") && !path.includes("..") && !path.includes("\\")) {
    return { href: path, reason: "" };
  }
  const reason = body && typeof body.reason === "string" ? body.reason : "";
  return { reason: PAY_REASONS.has(reason) ? reason : "Could not open the pay link." };
}
