import { NextResponse } from "next/server";
import { requireAdminInvoiceRead } from "@/lib/adminInvoiceRead";
import { ISSUER_COLUMNS, letterheadForInvoice } from "@/lib/invoicePay/company";
import { invoiceDocumentFor } from "@/lib/invoicePay/history";
import { renderInvoicePdf } from "@/lib/invoicePay/pdf";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await requireAdminInvoiceRead(id);
  if ("error" in access && access.error) return access.error;
  const { admin, tenantId, billTo } = access;
  const invoice = await admin
    .from("invoices")
    .select(
      `id, invoice_number, status, issued_at, due_at, period_start, period_end, subtotal_kes, credits_applied_kes, total_kes, amount_paid_kes, ${ISSUER_COLUMNS}`,
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (invoice.error) return NextResponse.json({ error: "Could not load this invoice." }, { status: 503 });
  if (!invoice.data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const lines = await admin
    .from("invoice_lines")
    .select("kind, description, quantity, unit_amount_kes, amount_kes, sort_order")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });
  if (lines.error) return NextResponse.json({ error: "Could not load this invoice." }, { status: 503 });
  const company = await letterheadForInvoice(admin, invoice.data);
  const doc = invoiceDocumentFor(invoice.data, lines.data || [], billTo, "", company);
  const pdf = renderInvoicePdf(doc);
  const name = invoice.data.invoice_number || "invoice";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
