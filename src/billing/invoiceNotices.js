const { formatKsh, toCents } = require("../../dashboard/src/lib/invoicePay/money");

function ksh(amount) {
  const cents = toCents(amount);
  return cents == null ? "KSh 0" : formatKsh(cents);
}

const INVOICE_NOTICE_KINDS = {
  issued: "platform_billing_invoice_issued",
  dueSoon: "platform_billing_invoice_due_soon",
  paymentReceived: "platform_billing_payment_received",
  overdue: "platform_billing_invoice_overdue",
};

function issuedNotice(invoice) {
  const number = invoice.number || "";
  return {
    kind: INVOICE_NOTICE_KINDS.issued,
    idempotencyKey: `${INVOICE_NOTICE_KINDS.issued}:${invoice.id}`,
    title: `Invoice ${number}`,
    body: `Your Business Assistant invoice ${number} for ${ksh(invoice.totalKes)} is ready.`,
  };
}

function dueSoonNotice(invoice) {
  const number = invoice.number || "";
  return {
    kind: INVOICE_NOTICE_KINDS.dueSoon,
    idempotencyKey: `${INVOICE_NOTICE_KINDS.dueSoon}:${invoice.id}`,
    title: "Invoice due soon",
    body: `Your Business Assistant invoice ${number} for ${ksh(invoice.totalKes)} is due soon.`,
  };
}

function overdueNotice(invoice) {
  const number = invoice.number || "";
  return {
    kind: INVOICE_NOTICE_KINDS.overdue,
    idempotencyKey: `${INVOICE_NOTICE_KINDS.overdue}:${invoice.id}`,
    title: "Invoice overdue",
    body: `Your Business Assistant invoice ${number} for ${ksh(invoice.totalKes)} is overdue.`,
  };
}

function paymentReceivedNotice(receipt) {
  return {
    kind: INVOICE_NOTICE_KINDS.paymentReceived,
    idempotencyKey: `${INVOICE_NOTICE_KINDS.paymentReceived}:${receipt.id}`,
    title: "Payment received",
    body: `Your Business Assistant payment of ${ksh(receipt.amountKes)} is received. Receipt ${receipt.number}. Reference ${receipt.reference || ""}.`,
  };
}

module.exports = {
  INVOICE_NOTICE_KINDS,
  issuedNotice,
  dueSoonNotice,
  overdueNotice,
  paymentReceivedNotice,
};
