/**
 * Payments (ADMIN_V2): pure shaping. No data access, no `@/` imports, so tests load it directly.
 * Match status is stored; "Needs a check" is the issue bucket.
 */

export type PaymentRow = {
  id: string;
  businessId: string;
  businessName: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** Whole cents (KES × 100). */
  amountCents: number;
  matchStatus: string;
  providerRef: string;
  paidAt: string | null;
  createdAt: string;
};

export type PaymentView = "needs_check" | "unmatched" | "partial" | "matched" | "all";

export const PAYMENT_VIEWS: { id: PaymentView; label: string }[] = [
  { id: "needs_check", label: "Needs a check" },
  { id: "unmatched", label: "Unmatched" },
  { id: "partial", label: "Partial" },
  { id: "matched", label: "Matched" },
  { id: "all", label: "All" },
];

export function displayStatus(r: PaymentRow): string {
  const s = r.matchStatus;
  if (s === "matched") return "Matched";
  if (s === "partial") return "Partial";
  if (s === "over") return "Over";
  if (s === "unmatched") return "Unmatched";
  if (s === "issue") return "Needs a check";
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Payment";
}

export function statusTone(r: PaymentRow): "ok" | "info" | "warn" | "danger" | "neutral" {
  if (r.matchStatus === "matched") return "ok";
  if (r.matchStatus === "partial" || r.matchStatus === "over") return "warn";
  if (r.matchStatus === "issue" || r.matchStatus === "unmatched") return "danger";
  return "neutral";
}

export function inPaymentView(r: PaymentRow, v: PaymentView): boolean {
  switch (v) {
    case "needs_check":
      return r.matchStatus === "issue";
    case "unmatched":
      return r.matchStatus === "unmatched";
    case "partial":
      return r.matchStatus === "partial" || r.matchStatus === "over";
    case "matched":
      return r.matchStatus === "matched";
    default:
      return true;
  }
}

export function paymentCounts(rows: PaymentRow[]): Record<PaymentView, number> {
  const out: Record<PaymentView, number> = {
    needs_check: 0,
    unmatched: 0,
    partial: 0,
    matched: 0,
    all: rows.length,
  };
  for (const r of rows) {
    for (const v of PAYMENT_VIEWS) {
      if (v.id !== "all" && inPaymentView(r, v.id)) out[v.id] += 1;
    }
  }
  return out;
}

/** Opens on Needs a check when it has rows, else Unmatched, else All. */
export function defaultPaymentView(rows: PaymentRow[]): PaymentView {
  if (rows.some((r) => r.matchStatus === "issue")) return "needs_check";
  if (rows.some((r) => r.matchStatus === "unmatched")) return "unmatched";
  if (rows.some((r) => r.matchStatus === "partial" || r.matchStatus === "over")) return "partial";
  return "all";
}

export function paymentTotals(rows: PaymentRow[]): { amount: number; count: number } {
  let amount = 0;
  for (const r of rows) amount += r.amountCents;
  return { amount, count: rows.length };
}

export function matchesPayment(r: PaymentRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    r.businessName.toLowerCase().includes(s) ||
    (r.invoiceNumber || "").toLowerCase().includes(s) ||
    r.providerRef.toLowerCase().includes(s) ||
    displayStatus(r).toLowerCase().includes(s)
  );
}

export function ksh(cents: number): string {
  const v = Math.round(cents) / 100;
  return `KSh ${v.toLocaleString("en-KE", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Honest why-lines for actions not wired yet (Unlock / credit-notes slices). */
export const PAYMENT_ACTION_WHY = {
  collect: "Collect needs step-up — not wired on this screen yet.",
  void: "Void needs step-up — not wired on this screen yet.",
  record: "Record payment needs step-up — not wired on this screen yet.",
} as const;
