import { nairobiDay } from "./billingBanner";
import { invoicePayState } from "./invoicePayState";

/** Fields Desk reads from GET /api/billing/invoices. Money strings are already formatted. */
export type BillingHistoryInvoice = {
  id?: string;
  number?: string | null;
  status?: string;
  due_at?: string | null;
  total_due?: string;
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

export function mapBillingHistory(
  body: BillingHistoryBody | null | undefined,
  options: { fromPay: boolean; beta?: boolean },
): MappedInvoice[] {
  const beta = Boolean(options.beta);
  const rows: MappedInvoice[] = (body?.invoices || []).flatMap((invoice) => {
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
    const due = nairobiDay(invoice.due_at);
    const statusLabel =
      pay.label === "Paid" || pay.label === "Checking payment" ? pay.label : due ? `Due by ${due}` : "Open";
    const total = invoice.total_due || "";
    return [
      {
        id,
        number: invoice.number || "Invoice",
        totalLabel: total,
        statusLabel,
        payLabel: pay.showPayButton && total ? `Pay ${total}` : null,
        payLinkPath: pay.showPayButton ? pay.payLinkPath : null,
      },
    ];
  });
  // Due invoices first, then the rest in the order the API sent them.
  const owed = (row: MappedInvoice) => (row.statusLabel === "Paid" || row.statusLabel === "Checking payment" ? 1 : 0);
  return rows.map((row, index) => ({ row, index })).sort((a, b) => owed(a.row) - owed(b.row) || a.index - b.index).map((item) => item.row);
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
