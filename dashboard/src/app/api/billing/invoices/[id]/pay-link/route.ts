import { NextResponse } from "next/server";
import { requireBillingRead } from "@/lib/invoicePay/billingRead";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireBillingRead();
  if ("error" in access && access.error) return access.error;
  const { tenant, admin } = access;
  const { id } = await context.params;
  const invoice = await admin
    .from("invoices")
    .select("id, status")
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (invoice.error) return NextResponse.json({ error: "Could not load this invoice." }, { status: 503 });
  if (!invoice.data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (invoice.data.status !== "open") {
    return NextResponse.json({ pay_path: null, reason: "This invoice is not open" }, { status: 409 });
  }
  const minted = await admin.rpc("mint_invoice_pay_token", { p_invoice_id: id, p_rotate: false });
  if (minted.error) {
    const message = minted.error.message || "";
    if (/already exists/i.test(message)) {
      return NextResponse.json({ pay_path: null, reason: "Pay link already issued" }, { status: 409 });
    }
    if (/beta|cannot be paid|nothing left/i.test(message)) {
      return NextResponse.json({ pay_path: null, reason: "This invoice cannot be paid here" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create a pay link." }, { status: 503 });
  }
  const token = minted.data && minted.data[0] && minted.data[0].token;
  if (!token) return NextResponse.json({ error: "Could not create a pay link." }, { status: 503 });
  return NextResponse.json({ pay_path: `/pay/${token}` }, { headers: { "Cache-Control": "no-store" } });
}
