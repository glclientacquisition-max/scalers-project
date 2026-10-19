/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const { shapeBillingHistory } = require("./history");

const INVOICE_COLUMNS =
  "id, invoice_number, status, issued_at, due_at, period_start, period_end, subtotal_kes, credits_applied_kes, total_kes, amount_paid_kes, tax_kes";

/**
 * Owner invoice list. Does not call the Bachs gate.
 * @param {{ from: Function }} admin
 * @param {string} tenantId
 */
async function listOwnerInvoices(admin, tenantId) {
  const invoices = await admin
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (invoices.error) return { ok: false, error: "Could not load invoices." };
  const ids = (invoices.data || []).map((row) => row.id);
  const lines = ids.length
    ? await admin
        .from("invoice_lines")
        .select("invoice_id, kind, description, quantity, unit_amount_kes, amount_kes, sort_order")
        .eq("tenant_id", tenantId)
        .in("invoice_id", ids)
    : { data: [], error: null };
  if (lines.error) return { ok: false, error: "Could not load invoices." };
  const receipts = await admin
    .from("invoice_receipts")
    .select("id, invoice_id, receipt_number, amount_kes, method, provider_ref, paid_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (receipts.error) return { ok: false, error: "Could not load invoices." };
  return {
    ok: true,
    body: shapeBillingHistory({
      invoices: invoices.data || [],
      lines: lines.data || [],
      receipts: receipts.data || [],
    }),
  };
}

module.exports = { listOwnerInvoices };
