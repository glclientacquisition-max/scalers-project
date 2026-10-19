/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { invoiceModel, receiptModel } = require("./documents");

/**
 * Sample documents only. These are the prices the owner locked for the examples:
 * Growth monthly KSh 18,000, extra seats KSh 500, inbound KSh 25 a minute,
 * message credits KSh 1. The package catalogue is unchanged.
 * Credits applied, proration, and the bill-to stay example.
 * The letterhead is the billing_company seed. Address, city, and KRA PIN are unset.
 */
const NOW = "2026-10-18T08:00:00Z";
const PAY_URL = "https://app.scalers.co.ke/pay/example-token";

const company = {
  legalName: "Scalers Ventures",
  product: "Business Assistant",
  phone: "+254119774470",
  email: "support@scalers.co.ke",
};

const billTo = {
  businessName: "example business",
  ownerName: "example owner",
  email: "example@example.com",
  phone: "example phone",
};

const period = {
  periodStart: "2026-10-01T00:00:00Z",
  periodEnd: "2026-10-31T21:00:00Z",
};

const openLines = [
  { kind: "plan", description: "Growth plan, monthly (Business Assistant)", quantity: "1", unitAmountKes: "18000.00", amountKes: "18000.00" },
  { kind: "extra_minutes", description: "Extra minutes, inbound", quantity: "40", unitAmountKes: "25.00", amountKes: "1000.00" },
  { kind: "extra_seats", description: "Extra seats", quantity: "2", unitAmountKes: "500.00", amountKes: "1000.00" },
  { kind: "message_credits", description: "Message credits", quantity: "100", unitAmountKes: "1.00", amountKes: "100.00" },
  { kind: "proration", description: "Proration, example", quantity: "1", unitAmountKes: "500.00", amountKes: "500.00" },
];

const openInvoiceRow = {
  number: "SCL-2026-000001",
  status: "open",
  issuedAt: "2026-10-18T08:00:00Z",
  dueAt: "2026-10-25T08:00:00Z",
  ...period,
  subtotalKes: "20600.00",
  creditsAppliedKes: "600.00",
  totalKes: "20000.00",
  amountPaidKes: "0",
};

function openInvoice() {
  return invoiceModel({ now: NOW, payUrl: PAY_URL, billTo, company, lines: openLines, invoice: openInvoiceRow });
}

function paidInvoice() {
  return invoiceModel({
    now: NOW,
    payUrl: PAY_URL,
    billTo,
    company,
    lines: openLines,
    invoice: { ...openInvoiceRow, status: "paid", amountPaidKes: "20000.00" },
  });
}

function receiptDoc() {
  return receiptModel({
    billTo,
    company,
    lines: openLines,
    invoice: {
      ...period,
      subtotalKes: openInvoiceRow.subtotalKes,
      creditsAppliedKes: openInvoiceRow.creditsAppliedKes,
      totalKes: openInvoiceRow.totalKes,
    },
    receipt: {
      number: "RCT-2026-000001",
      invoiceNumber: "SCL-2026-000001",
      reference: "example-bachs-ref",
      amountKes: "20000.00",
      method: "M-Pesa",
      paidAt: "2026-10-18T12:00:00Z",
    },
  });
}

function splitInvoice() {
  return invoiceModel({
    now: NOW,
    payUrl: PAY_URL,
    billTo,
    company,
    lines: [
      { kind: "plan", description: "Growth plan, monthly (Business Assistant)", quantity: "1", unitAmountKes: "18000.00", amountKes: "18000.00" },
      { kind: "extra_minutes", description: "Extra minutes, inbound", quantity: "5600", unitAmountKes: "25.00", amountKes: "140000.00" },
      { kind: "extra_seats", description: "Extra seats", quantity: "4", unitAmountKes: "500.00", amountKes: "2000.00" },
      { kind: "message_credits", description: "Message credits", quantity: "200", unitAmountKes: "1.00", amountKes: "200.00" },
    ],
    invoice: {
      number: "SCL-2026-000002",
      status: "open",
      issuedAt: "2026-10-18T08:00:00Z",
      dueAt: "2026-10-25T08:00:00Z",
      ...period,
      subtotalKes: "160200.00",
      creditsAppliedKes: "200.00",
      totalKes: "160000.00",
      amountPaidKes: "0",
    },
  });
}

module.exports = { openInvoice, paidInvoice, receiptDoc, splitInvoice };
