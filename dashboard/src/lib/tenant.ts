import { getSupabaseAdmin, type TenantRow } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { defaultTenantLlmPrompt } from "@/lib/prompts";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import {
  DEFAULT_VOICE_LANGUAGES,
  normalizeVoiceLanguages,
  type VoiceLanguageCode,
} from "@/lib/languages";

const TENANT_SELECT =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, llm_system_prompt, is_active, voice_languages, voice_language_other";

function shapeTenant(row: Record<string, unknown> | null): TenantRow | null {
  if (!row) return null;
  return {
    id: String(row.id),
    business_name: String(row.business_name || ""),
    sautikit_virtual_number: String(row.sautikit_virtual_number || ""),
    whatsapp_notification_number: String(row.whatsapp_notification_number || ""),
    llm_system_prompt: (row.llm_system_prompt as string | null) ?? null,
    is_active: (row.is_active as boolean | null) ?? null,
    voice_languages: normalizeVoiceLanguages(row.voice_languages),
    voice_language_other: (row.voice_language_other as string | null) ?? null,
  };
}

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
      .select(TENANT_SELECT)
      .eq("id", membership.tenant_id)
      .maybeSingle();

    if (error) {
      // Column may not exist until voice_languages.sql is applied — retry without it.
      if (/voice_language/i.test(error.message)) {
        const { data: legacy, error: legacyErr } = await admin
          .from("tenants")
          .select(
            "id, business_name, sautikit_virtual_number, whatsapp_notification_number, llm_system_prompt, is_active"
          )
          .eq("id", membership.tenant_id)
          .maybeSingle();
        if (legacyErr) throw legacyErr;
        return shapeTenant({
          ...(legacy || {}),
          voice_languages: DEFAULT_VOICE_LANGUAGES,
          voice_language_other: null,
        });
      }
      throw error;
    }
    return shapeTenant(data as Record<string, unknown>);
  }

  // Legacy shared-password desk: first active tenant (single-tenant demo).
  if (await isLegacyAuthenticated()) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("tenants")
      .select(TENANT_SELECT)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (/voice_language/i.test(error.message)) {
        const { data: legacy, error: legacyErr } = await admin
          .from("tenants")
          .select(
            "id, business_name, sautikit_virtual_number, whatsapp_notification_number, llm_system_prompt, is_active"
          )
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (legacyErr) throw legacyErr;
        return shapeTenant({
          ...(legacy || {}),
          voice_languages: DEFAULT_VOICE_LANGUAGES,
          voice_language_other: null,
        });
      }
      throw error;
    }
    return shapeTenant(data as Record<string, unknown>);
  }

  return null;
}

/** Claim next available DID from sautikit_did_pool (no-op if already assigned / pool empty). */
export async function assignDidFromPool(tenantId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("assign_did_from_pool", {
    p_tenant_id: tenantId,
  });
  if (error) {
    // Pool SQL not applied yet — leave pending DID.
    console.warn("[tenant] assign_did_from_pool:", error.message);
    return null;
  }
  return (data as string) || null;
}

/**
 * Fallback provisioner if the Auth trigger has not run yet (SQL not applied).
 * Idempotent — safe to call after every signup. Also retries DID pool assign.
 */
export async function ensureTenantForUser(opts: {
  userId: string;
  businessName: string;
  notificationPhone: string;
  voiceLanguages?: VoiceLanguageCode[] | string[] | null;
  voiceLanguageOther?: string | null;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", opts.userId)
    .limit(1)
    .maybeSingle();

  if (existing?.tenant_id) {
    await assignDidFromPool(existing.tenant_id);
    return existing.tenant_id;
  }

  const businessName = opts.businessName.trim();
  const phone = opts.notificationPhone.trim() || "pending";
  const voiceLanguages = normalizeVoiceLanguages(opts.voiceLanguages);
  const voiceLanguageOther = opts.voiceLanguageOther?.trim() || null;

  const row: Record<string, unknown> = {
    business_name: businessName,
    sautikit_virtual_number: `pending:${opts.userId}`,
    whatsapp_notification_number: phone,
    llm_system_prompt: defaultTenantLlmPrompt(
      businessName,
      voiceLanguages,
      voiceLanguageOther
    ),
    is_active: true,
    telecom_wallet_balance_kes: 0,
    ai_wallet_balance_usd: 0,
  };

  // Prefer writing language columns when voice_languages.sql is applied.
  const rowWithLangs = {
    ...row,
    voice_languages: voiceLanguages,
    voice_language_other: voiceLanguageOther,
  };

  // owner_user_id exists after multi_tenant_onboarding.sql; ignore if missing.
  let { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .insert({ ...rowWithLangs, owner_user_id: opts.userId })
    .select("id")
    .single();

  if (tenantErr?.message?.toLowerCase().includes("owner_user_id")) {
    ({ data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .insert(rowWithLangs)
      .select("id")
      .single());
  }

  // Columns missing until voice_languages.sql — retry without them.
  if (tenantErr && /voice_language/i.test(tenantErr.message)) {
    ({ data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .insert({ ...row, owner_user_id: opts.userId })
      .select("id")
      .single());
    if (tenantErr?.message?.toLowerCase().includes("owner_user_id")) {
      ({ data: tenant, error: tenantErr } = await admin
        .from("tenants")
        .insert(row)
        .select("id")
        .single());
    }
  }

  if (tenantErr) throw tenantErr;
  if (!tenant?.id) throw new Error("Tenant insert returned no id");

  const { error: memErr } = await admin.from("tenant_members").insert({
    user_id: opts.userId,
    tenant_id: tenant.id,
    role: "owner",
  });
  if (memErr) throw memErr;

  await assignDidFromPool(tenant.id);
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
