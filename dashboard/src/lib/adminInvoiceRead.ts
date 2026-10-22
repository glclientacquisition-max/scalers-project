import "server-only";
import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { billToFromTenant } from "@/lib/invoicePay/billingRead";

export async function requireAdminInvoiceRead(invoiceId: string) {
  if (!(await isLegacyAuthenticated())) {
    return { error: NextResponse.json({ error: "ops_only" }, { status: 403 }) };
  }
  const admin = getSupabaseAdmin();
  const invoice = await admin
    .from("invoices")
    .select("id, tenant_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoice.error) return { error: NextResponse.json({ error: "Could not load this invoice." }, { status: 503 }) };
  if (!invoice.data) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  const tenantId = String(invoice.data.tenant_id);
  const tenantRes = await admin
    .from("tenants")
    .select("id, business_name, alert_email, whatsapp_notification_number")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantRes.error || !tenantRes.data) {
    return { error: NextResponse.json({ error: "Could not load this invoice." }, { status: 503 }) };
  }
  return { admin, tenant: tenantRes.data, tenantId, billTo: billToFromTenant(tenantRes.data) };
}
