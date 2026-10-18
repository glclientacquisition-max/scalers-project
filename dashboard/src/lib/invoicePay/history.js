/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { invoiceModel, receiptModel } = require("./documents");
const { letterheadFromInvoice } = require("./company");
const { formatKsh, toCents } = require("./money");

function ksh(amount) {
  const cents = toCents(amount == null ? "0" : amount);
  return formatKsh(cents == null ? 0n : cents);
}

function balanceLabel(total, paid) {
  const left = (toCents(total) || 0n) - (toCents(paid) || 0n);
  return formatKsh(left > 0n ? left : 0n);
}

/**
 * Owner billing history. Pay links are not listed here. Desk asks
 * POST /api/billing/invoices/:id/pay-link for an open invoice.
 * @param {{ invoices: object[], lines: object[], receipts: object[] }} input
 */
function shapeBillingHistory(input) {
  const lines = input.lines || [];
  const receipts = input.receipts || [];
  return {
    invoices: (input.invoices || []).map((row) => ({
      id: row.id,
      number: row.invoice_number || null,
      status: row.status,
      issued_at: row.issued_at || null,
      due_at: row.due_at || null,
      period_start: row.period_start || null,
      period_end: row.period_end || null,
      subtotal: ksh(row.subtotal_kes),
      credits_applied: row.credits_applied_kes != null ? ksh(row.credits_applied_kes) : null,
      total_due: ksh(row.total_kes),
      amount_paid: ksh(row.amount_paid_kes),
      balance: balanceLabel(row.total_kes, row.amount_paid_kes),
      tax_kes: row.tax_kes == null ? null : String(row.tax_kes),
      pdf_path: `/api/billing/invoices/${row.id}/pdf`,
      html_path: `/api/billing/invoices/${row.id}?format=html`,
      pay_link_path: row.status === "open" ? `/api/billing/invoices/${row.id}/pay-link` : null,
      lines: lines
        .filter((line) => line.invoice_id === row.id)
        .map((line) => ({
          kind: line.kind || null,
          description: line.description,
          quantity: String(line.quantity),
          unit_price: ksh(line.unit_amount_kes),
          amount: ksh(line.amount_kes),
        })),
    })),
    receipts: receipts.map((row) => ({
      id: row.id,
      number: row.receipt_number,
      invoice_id: row.invoice_id,
      amount: ksh(row.amount_kes),
      method: row.method,
      reference: row.provider_ref || null,
      paid_at: row.paid_at,
      pdf_path: `/api/billing/receipts/${row.id}/pdf`,
      html_path: `/api/billing/receipts/${row.id}?format=html`,
    })),
  };
}

function documentLines(lines) {
  return (lines || []).map((line) => ({
    kind: line.kind,
    description: line.description,
    quantity: line.quantity,
    unitAmountKes: line.unit_amount_kes,
    amountKes: line.amount_kes,
  }));
}

function invoiceDocumentFor(row, lines, billTo, payUrl, company) {
  return invoiceModel({
    invoice: {
      number: row.invoice_number,
      status: row.status,
      issuedAt: row.issued_at,
      dueAt: row.due_at,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      subtotalKes: row.subtotal_kes,
      creditsAppliedKes: row.credits_applied_kes,
      totalKes: row.total_kes,
      amountPaidKes: row.amount_paid_kes,
    },
    lines: documentLines(lines),
    billTo,
    payUrl,
    company: company || letterheadFromInvoice(row) || undefined,
  });
}

function receiptDocumentFor(row, billTo, invoice, lines, company) {
  const source = invoice && typeof invoice === "object" ? invoice : { invoice_number: invoice || "" };
  return receiptModel({
    receipt: {
      number: row.receipt_number,
      invoiceNumber: source.invoice_number || "",
      reference: row.provider_ref,
      amountKes: row.amount_kes,
      method: row.method,
      paidAt: row.paid_at,
    },
    invoice: {
      periodStart: source.period_start,
      periodEnd: source.period_end,
      subtotalKes: source.subtotal_kes,
      creditsAppliedKes: source.credits_applied_kes,
      totalKes: source.total_kes,
    },
    lines: documentLines(lines),
    billTo,
    company: company || letterheadFromInvoice(source) || undefined,
  });
}

module.exports = { shapeBillingHistory, invoiceDocumentFor, receiptDocumentFor };
