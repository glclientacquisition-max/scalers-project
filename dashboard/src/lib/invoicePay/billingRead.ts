import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/lib/tenant";
import { getSupabaseAdmin } from "@/lib/supabase";
import { assertBachsAllowed } from "./provider";

export async function requireBillingRead() {
  try {
    assertBachsAllowed();
  } catch {
    return { error: NextResponse.json({ error: "unavailable" }, { status: 503 }) };
  }
  const tenant = await getCurrentTenant();
  if (!tenant?.id) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { tenant, admin: getSupabaseAdmin() };
}

export function billToFromTenant(tenant: {
  business_name?: string | null;
  alert_email?: string | null;
  whatsapp_notification_number?: string | null;
}) {
  const phone = tenant.whatsapp_notification_number || "";
  return {
    businessName: tenant.business_name || "",
    ownerName: tenant.business_name || "",
    email: tenant.alert_email || "",
    phone: phone.startsWith("pending:") ? "" : phone,
  };
}
