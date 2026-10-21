import { NextResponse } from "next/server";
import { requireBillingRead } from "@/lib/invoicePay/billingRead";
import { listOwnerInvoices } from "@/lib/invoicePay/invoiceList";

export async function GET() {
  const access = await requireBillingRead();
  if ("error" in access && access.error) return access.error;
  const { tenant, admin } = access;
  const listed = await listOwnerInvoices(admin, tenant.id);
  if (!listed.ok) {
    return NextResponse.json({ error: listed.error }, { status: 503 });
  }
  return NextResponse.json(listed.body, { headers: { "Cache-Control": "no-store" } });
}
