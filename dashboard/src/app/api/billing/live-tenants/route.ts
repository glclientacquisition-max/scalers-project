import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { adminActorName } from "@/lib/adminActor";
import { getSupabaseAdmin } from "@/lib/supabase";
import { liveTenantPostError } from "@/lib/invoicePay/liveTenantsApi";

/**
 * Super Admin list and set for billing_live_tenants.
 * POST requires confirm: true and a reason. The SQL function refuses beta.
 * Signed-out visitors are redirected to /admin/login by requireSuperAdmin.
 * That redirect is expected. This route does not return 401.
 */
export async function GET() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_live_tenants")
    .select("tenant_id, enabled, reason, set_by, set_at")
    .order("set_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true, tenants: data || [] });
}

export async function POST(request: Request) {
  await requireSuperAdmin();
  const body = await request.json().catch(() => null);
  const problem = liveTenantPostError(body);
  if (problem || !body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: problem || "confirm" }, { status: 400 });
  }
  const posted = body as { tenantId: string; enabled: boolean; reason: string };
  const actor = await adminActorName();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("admin_set_tenant_live_payments", {
    p_tenant_id: posted.tenantId.trim(),
    p_enabled: posted.enabled,
    p_reason: posted.reason.trim(),
    p_actor: actor,
  });
  if (error) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ ok: true, tenant: data });
}
