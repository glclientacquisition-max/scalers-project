import { NextResponse } from "next/server";
import { billToFromTenant, requireBillingRead } from "@/lib/invoicePay/billingRead";
import { ISSUER_COLUMNS, letterheadForInvoice } from "@/lib/invoicePay/company";
import { invoiceDocumentFor } from "@/lib/invoicePay/history";
import { renderInvoiceHtml } from "@/lib/invoicePay/documents";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireBillingRead();
  if ("error" in access && access.error) return access.error;
  const { tenant, admin } = access;
  const { id } = await context.params;
  const invoice = await admin
    .from("invoices")
    .select(
      `id, invoice_number, status, issued_at, due_at, period_start, period_end, subtotal_kes, credits_applied_kes, total_kes, amount_paid_kes, tax_kes, ${ISSUER_COLUMNS}`
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
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "html") {
    const company = await letterheadForInvoice(admin, invoice.data);
    const doc = invoiceDocumentFor(invoice.data, lines.data || [], billToFromTenant(tenant), "", company);
    return new NextResponse(renderInvoiceHtml(doc), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json(
    { invoice: invoice.data, lines: lines.data || [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
