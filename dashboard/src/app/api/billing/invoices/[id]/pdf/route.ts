import { NextResponse } from "next/server";
import { billToFromTenant, requireBillingRead } from "@/lib/invoicePay/billingRead";
import { invoiceDocumentFor } from "@/lib/invoicePay/history";
import { renderInvoicePdf } from "@/lib/invoicePay/pdf";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireBillingRead();
  if ("error" in access && access.error) return access.error;
  const { tenant, admin } = access;
  const { id } = await context.params;
  const invoice = await admin
    .from("invoices")
    .select(
      "id, invoice_number, status, issued_at, due_at, period_start, period_end, subtotal_kes, credits_applied_kes, total_kes, amount_paid_kes"
    )
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (invoice.error) return NextResponse.json({ error: "Could not load this invoice." }, { status: 503 });
  if (!invoice.data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const lines = await admin
    .from("invoice_lines")
    .select("kind, description, quantity, unit_amount_kes, amount_kes, sort_order")
    .eq("tenant_id", tenant.id)
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });
  if (lines.error) return NextResponse.json({ error: "Could not load this invoice." }, { status: 503 });
  const doc = invoiceDocumentFor(invoice.data, lines.data || [], billToFromTenant(tenant), "");
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
