import { NextResponse } from "next/server";
import { billToFromTenant, requireBillingRead } from "@/lib/invoicePay/billingRead";
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
    .select("invoice_number")
    .eq("id", receipt.data.invoice_id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  const doc = receiptDocumentFor(receipt.data, billToFromTenant(tenant), invoice.data?.invoice_number || "");
  const pdf = renderReceiptPdf(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${receipt.data.receipt_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
