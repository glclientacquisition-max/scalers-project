/** Paid comes only from invoices.status. The client never sets it. */

export type InvoicePayView = {
  label: "Paid" | "Checking payment" | "Open" | null;
  showPayButton: boolean;
  payHref: string | null;
  note: string | null;
  hidden: boolean;
};

export function invoicePayState(input: {
  status: string;
  payToken?: string | null;
  returnedFromPay?: boolean;
}): InvoicePayView {
  if (input.status === "draft") {
    return { label: null, showPayButton: false, payHref: null, note: null, hidden: true };
  }
  if (input.status === "paid") {
    return { label: "Paid", showPayButton: false, payHref: null, note: null, hidden: false };
  }
  if (input.returnedFromPay && input.status !== "paid") {
    return {
      label: "Checking payment",
      showPayButton: false,
      payHref: null,
      note: null,
      hidden: false,
    };
  }
  if (input.status === "open" && input.payToken) {
    return {
      label: "Open",
      showPayButton: true,
      payHref: `/pay/${input.payToken}`,
      note: null,
      hidden: false,
    };
  }
  if (input.status === "open") {
    return {
      label: "Open",
      showPayButton: false,
      payHref: null,
      note: "Pay link coming by SMS and email",
      hidden: false,
    };
  }
  return { label: null, showPayButton: false, payHref: null, note: null, hidden: false };
}
