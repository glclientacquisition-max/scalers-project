import { NextResponse } from "next/server";
import { requireBillingRead } from "@/lib/invoicePay/billingRead";
import { shapeBillingHistory } from "@/lib/invoicePay/history";

export async function GET() {
  const access = await requireBillingRead();
  if ("error" in access && access.error) return access.error;
  const { tenant, admin } = access;
  const invoices = await admin
    .from("invoices")
    .select(
      "id, invoice_number, status, issued_at, due_at, period_start, period_end, subtotal_kes, credits_applied_kes, total_kes, amount_paid_kes, tax_kes"
    )
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false });
  if (invoices.error) {
    return NextResponse.json({ error: "Could not load invoices." }, { status: 503 });
  }
  const ids = (invoices.data || []).map((row) => row.id);
  const lines = ids.length
    ? await admin
        .from("invoice_lines")
        .select("invoice_id, kind, description, quantity, unit_amount_kes, amount_kes, sort_order")
        .eq("tenant_id", tenant.id)
        .in("invoice_id", ids)
    : { data: [], error: null };
  if (lines.error) {
    return NextResponse.json({ error: "Could not load invoices." }, { status: 503 });
  }
  const receipts = await admin
    .from("invoice_receipts")
    .select("id, invoice_id, receipt_number, amount_kes, method, provider_ref, paid_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false });
  if (receipts.error) {
    return NextResponse.json({ error: "Could not load invoices." }, { status: 503 });
  }
  return NextResponse.json(
    shapeBillingHistory({
      invoices: invoices.data || [],
      lines: lines.data || [],
      receipts: receipts.data || [],
    }),
    { headers: { "Cache-Control": "no-store" } }
  );
}
