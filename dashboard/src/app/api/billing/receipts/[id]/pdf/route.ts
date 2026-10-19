import { NextResponse } from "next/server";
import { billToFromTenant, requireBillingRead } from "@/lib/invoicePay/billingRead";
import { ISSUER_COLUMNS, letterheadForInvoice } from "@/lib/invoicePay/company";
import { receiptDocumentFor } from "@/lib/invoicePay/history";
import { renderReceiptPdf } from "@/lib/invoicePay/pdf";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireBillingRead();
  if ("error" in access && access.error) return access.error;
  const { tenant, admin } = access;
  const { id } = await context.params;
  const receipt = await admin
    .from("invoice_receipts")
    .select("id, invoice_id, receipt_number, amount_kes, method, provider_ref, paid_at")
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (receipt.error) return NextResponse.json({ error: "Could not load this receipt." }, { status: 503 });
  if (!receipt.data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const invoice = await admin
    .from("invoices")
    .select(`invoice_number, period_start, period_end, subtotal_kes, credits_applied_kes, total_kes, ${ISSUER_COLUMNS}`)
    .eq("id", receipt.data.invoice_id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  const lines = await admin
    .from("invoice_lines")
    .select("kind, description, quantity, unit_amount_kes, amount_kes, sort_order")
    .eq("tenant_id", tenant.id)
    .eq("invoice_id", receipt.data.invoice_id)
    .order("sort_order", { ascending: true });
  if (lines.error) return NextResponse.json({ error: "Could not load this receipt." }, { status: 503 });
  const company = await letterheadForInvoice(admin, invoice.data || {});
  const doc = receiptDocumentFor(receipt.data, billToFromTenant(tenant), invoice.data || {}, lines.data || [], company);
  const pdf = renderReceiptPdf(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${receipt.data.receipt_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
