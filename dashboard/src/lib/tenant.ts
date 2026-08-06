import { getSupabaseAdmin, type TenantRow } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { defaultTenantLlmPrompt } from "@/lib/prompts";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";

/** Resolve the signed-in user's tenant (via tenant_members), or legacy first-active. */
export async function getCurrentTenant(): Promise<TenantRow | null> {
  const user = await getAuthUser();

  if (user) {
    const admin = getSupabaseAdmin();
    const { data: membership, error: memErr } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memErr) throw memErr;
    if (!membership?.tenant_id) return null;

    const { data, error } = await admin
      .from("tenants")
      .select(
        "id, business_name, sautikit_virtual_number, whatsapp_notification_number, llm_system_prompt, is_active"
      )
      .eq("id", membership.tenant_id)
      .maybeSingle();

    if (error) throw error;
    return (data as TenantRow) || null;
  }

  // Legacy shared-password desk: first active tenant (single-tenant demo).
  if (await isLegacyAuthenticated()) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("tenants")
      .select(
        "id, business_name, sautikit_virtual_number, whatsapp_notification_number, llm_system_prompt, is_active"
      )
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as TenantRow) || null;
  }

  return null;
}

/**
 * Fallback provisioner if the Auth trigger has not run yet (SQL not applied).
 * Idempotent — safe to call after every signup.
 */
export async function ensureTenantForUser(opts: {
  userId: string;
  businessName: string;
  notificationPhone: string;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", opts.userId)
    .limit(1)
    .maybeSingle();

  if (existing?.tenant_id) return existing.tenant_id;

  const businessName = opts.businessName.trim();
  const phone = opts.notificationPhone.trim() || "pending";

  const row: Record<string, unknown> = {
    business_name: businessName,
    sautikit_virtual_number: `pending:${opts.userId}`,
    whatsapp_notification_number: phone,
    llm_system_prompt: defaultTenantLlmPrompt(businessName),
    is_active: true,
    telecom_wallet_balance_kes: 0,
    ai_wallet_balance_usd: 0,
  };

  // owner_user_id exists after multi_tenant_onboarding.sql; ignore if missing.
  let { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .insert({ ...row, owner_user_id: opts.userId })
    .select("id")
    .single();

  if (tenantErr?.message?.toLowerCase().includes("owner_user_id")) {
    ({ data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .insert(row)
      .select("id")
      .single());
  }

  if (tenantErr) throw tenantErr;
  if (!tenant?.id) throw new Error("Tenant insert returned no id");

  const { error: memErr } = await admin.from("tenant_members").insert({
    user_id: opts.userId,
    tenant_id: tenant.id,
    role: "owner",
  });
  if (memErr) throw memErr;

  return tenant.id as string;
}

/** Soft check that the Auth session client can see the current user. */
export async function requireSupabaseUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
