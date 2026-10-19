/** Paid comes only from invoices.status. The client never sets it. */

export type InvoicePayView = {
  label: "Paid" | "Checking payment" | "Open" | null;
  showPayButton: boolean;
  /** POST path for an open invoice. The raw pay token is not stored here. */
  payLinkPath: string | null;
  note: string | null;
  hidden: boolean;
};

export function invoicePayState(input: {
  status: string;
  payLinkPath?: string | null;
  returnedFromPay?: boolean;
  beta?: boolean;
}): InvoicePayView {
  if (input.status === "draft") {
    return { label: null, showPayButton: false, payLinkPath: null, note: null, hidden: true };
  }
  if (input.status === "paid") {
    return { label: "Paid", showPayButton: false, payLinkPath: null, note: null, hidden: false };
  }
  if (input.returnedFromPay && input.status !== "paid") {
    return {
      label: "Checking payment",
      showPayButton: false,
      payLinkPath: null,
      note: null,
      hidden: false,
    };
  }
  if (input.status === "open" && input.payLinkPath && !input.beta) {
    return {
      label: "Open",
      showPayButton: true,
      payLinkPath: input.payLinkPath,
      note: null,
      hidden: false,
    };
  }
  if (input.status === "open") {
    return {
      label: "Open",
      showPayButton: false,
      payLinkPath: null,
      note: null,
      hidden: false,
    };
  }
  return { label: null, showPayButton: false, payLinkPath: null, note: null, hidden: false };
}
