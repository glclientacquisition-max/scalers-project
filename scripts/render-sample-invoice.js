#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invoiceModel, receiptModel, renderInvoiceHtml, renderReceiptHtml } = require("../dashboard/src/lib/invoicePay/documents");
const { renderInvoicePdf, renderReceiptPdf } = require("../dashboard/src/lib/invoicePay/pdf");

const dir = process.argv[2] || "/opt/cursor/artifacts";
fs.mkdirSync(dir, { recursive: true });
const billTo = {
  businessName: "example business",
  ownerName: "example owner",
  email: "example@example.com",
  phone: "example phone",
};
const invoice = invoiceModel({
  invoice: {
    number: "SCL-2026-000001",
    issuedAt: "2026-10-18T08:00:00Z",
    dueAt: "2026-10-25T08:00:00Z",
    periodStart: "2026-10-01T00:00:00Z",
    periodEnd: "2026-10-31T21:00:00Z",
    subtotalKes: "7000.00",
    creditsAppliedKes: "500.00",
    totalKes: "6500.00",
    amountPaidKes: "0",
  },
  lines: [
    { kind: "plan", description: "Business Assistant plan", quantity: "1", unitAmountKes: "5000.00", amountKes: "5000.00" },
    { kind: "extra_minutes", description: "Extra minutes", quantity: "100", unitAmountKes: "6.00", amountKes: "600.00" },
    { kind: "extra_seats", description: "Extra seats", quantity: "1", unitAmountKes: "800.00", amountKes: "800.00" },
    { kind: "message_credits", description: "Message credits", quantity: "50", unitAmountKes: "2.00", amountKes: "100.00" },
    { kind: "proration", description: "Proration", quantity: "1", unitAmountKes: "500.00", amountKes: "500.00" },
  ],
  billTo,
  payUrl: "https://app.scalers.co.ke/pay/example-token",
});
const receipt = receiptModel({
  billTo,
  receipt: {
    number: "RCT-2026-000001",
    invoiceNumber: "SCL-2026-000001",
    reference: "example-bachs-ref",
    amountKes: "6500.00",
    method: "M-Pesa",
    paidAt: "2026-10-18T12:00:00Z",
  },
});
const files = {
  "invoice-SCL-2026-000001.html": renderInvoiceHtml(invoice),
  "invoice-SCL-2026-000001.pdf": renderInvoicePdf(invoice),
  "receipt-RCT-2026-000001.html": renderReceiptHtml(receipt),
  "receipt-RCT-2026-000001.pdf": renderReceiptPdf(receipt),
};
for (const [name, body] of Object.entries(files)) {
  fs.writeFileSync(path.join(dir, name), body);
  console.log(path.join(dir, name));
}
