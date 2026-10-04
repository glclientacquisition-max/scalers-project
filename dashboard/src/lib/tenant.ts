import { cache } from "react";
import { cookies } from "next/headers";
import { getSupabaseAdmin, type TenantRow } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { defaultTenantLlmPrompt } from "@/lib/prompts";
import { getAuthUser, isLegacyAuthenticated } from "@/lib/auth";
import { DESK_TENANT_COOKIE } from "@/lib/deskTenantCookie";
import type { SupabaseClient } from "@supabase/supabase-js";

const TENANT_SELECT_NO_GREETING_IDENTITY =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email, notify_channels, llm_system_prompt, services_offered, services_catalog, product_catalog, social_handles, business_hours, hours_schedule, after_hours_mode, agent_name, agent_tone, team_directory, faqs, unknown_answer_fallback, daily_bulletin, agent_tools, vertical, handoff_mode, business_locations, business_policies, tts_lexicon, soniox_voice_id, soniox_voice_label, wallet_balance_kes, wallet_low_balance_kes, billing_enforcement, soft_spend_limit_enabled, soft_spend_limit_kes, on_demand_usage_enabled, sms_included_units, sms_used_units, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active";

const TENANT_SELECT =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email, notify_channels, llm_system_prompt, services_offered, services_catalog, product_catalog, social_handles, business_hours, hours_schedule, after_hours_mode, agent_name, spoken_name, greeting_invite, agent_tone, team_directory, faqs, unknown_answer_fallback, daily_bulletin, agent_tools, vertical, handoff_mode, business_locations, business_policies, tts_lexicon, soniox_voice_id, soniox_voice_label, wallet_balance_kes, wallet_low_balance_kes, billing_enforcement, soft_spend_limit_enabled, soft_spend_limit_kes, on_demand_usage_enabled, sms_included_units, sms_used_units, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active";

const TENANT_SELECT_NO_SMS_ALLOWANCE =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email, notify_channels, llm_system_prompt, services_offered, services_catalog, product_catalog, social_handles, business_hours, hours_schedule, after_hours_mode, agent_name, agent_tone, team_directory, faqs, unknown_answer_fallback, daily_bulletin, agent_tools, vertical, handoff_mode, business_locations, business_policies, tts_lexicon, soniox_voice_id, soniox_voice_label, wallet_balance_kes, wallet_low_balance_kes, billing_enforcement, soft_spend_limit_enabled, soft_spend_limit_kes, on_demand_usage_enabled, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active";

const TENANT_SELECT_NO_NOTIFY_CHANNELS =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email, llm_system_prompt, services_offered, services_catalog, product_catalog, social_handles, business_hours, hours_schedule, after_hours_mode, agent_name, agent_tone, team_directory, faqs, unknown_answer_fallback, daily_bulletin, agent_tools, vertical, handoff_mode, business_locations, business_policies, tts_lexicon, soniox_voice_id, soniox_voice_label, wallet_balance_kes, wallet_low_balance_kes, billing_enforcement, soft_spend_limit_enabled, soft_spend_limit_kes, on_demand_usage_enabled, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active";

const TENANT_SELECT_NO_SONIOX_VOICE =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email, llm_system_prompt, services_offered, services_catalog, product_catalog, social_handles, business_hours, hours_schedule, after_hours_mode, agent_name, agent_tone, team_directory, faqs, unknown_answer_fallback, daily_bulletin, agent_tools, vertical, handoff_mode, business_locations, business_policies, tts_lexicon, wallet_balance_kes, wallet_low_balance_kes, billing_enforcement, soft_spend_limit_enabled, soft_spend_limit_kes, on_demand_usage_enabled, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active";

const TENANT_SELECT_NO_SOFT_LIMIT =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email, llm_system_prompt, services_offered, services_catalog, product_catalog, social_handles, business_hours, hours_schedule, after_hours_mode, agent_name, agent_tone, team_directory, faqs, unknown_answer_fallback, daily_bulletin, agent_tools, vertical, handoff_mode, business_locations, business_policies, tts_lexicon, wallet_balance_kes, wallet_low_balance_kes, billing_enforcement, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active";

const TENANT_SELECT_NO_TTS_LEXICON =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email, llm_system_prompt, services_offered, services_catalog, product_catalog, social_handles, business_hours, hours_schedule, after_hours_mode, agent_name, agent_tone, team_directory, faqs, unknown_answer_fallback, daily_bulletin, agent_tools, vertical, handoff_mode, business_locations, business_policies, wallet_balance_kes, wallet_low_balance_kes, billing_enforcement, soft_spend_limit_enabled, soft_spend_limit_kes, on_demand_usage_enabled, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active";

const TENANT_SELECT_NO_PRODUCT_SOCIAL =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email, llm_system_prompt, services_offered, services_catalog, business_hours, hours_schedule, after_hours_mode, agent_name, agent_tone, team_directory, faqs, unknown_answer_fallback, daily_bulletin, agent_tools, vertical, handoff_mode, business_locations, business_policies, tts_lexicon, wallet_balance_kes, wallet_low_balance_kes, billing_enforcement, soft_spend_limit_enabled, soft_spend_limit_kes, on_demand_usage_enabled, telecom_wallet_balance_kes, ai_wallet_balance_usd, is_active";

const TENANT_SELECT_LEGACY =
  "id, business_name, sautikit_virtual_number, whatsapp_notification_number, llm_system_prompt, is_active";

function isMissingGreetingIdentityColumnError(message: string): boolean {
  return /spoken_name|greeting_invite/i.test(message);
}

function isMissingSmsAllowanceColumnError(message: string): boolean {
  return /sms_included_units|sms_used_units/i.test(message);
}

function isMissingNotifyChannelsColumnError(message: string): boolean {
  return /notify_channels/i.test(message);
}

function isMissingSonioxVoiceColumnError(message: string): boolean {
  return /soniox_voice_id|soniox_voice_label/i.test(message);
}

function isMissingSoftSpendLimitColumnError(message: string): boolean {
  return /soft_spend_limit_enabled|soft_spend_limit_kes|on_demand_usage_enabled/i.test(message);
}

function isMissingTtsLexiconColumnError(message: string): boolean {
  return /tts_lexicon/i.test(message);
}

function isMissingProductSocialColumnError(message: string): boolean {
  return /product_catalog|social_handles/i.test(message);
}

function isMissingProfileColumnError(message: string): boolean {
  return /business_hours|hours_schedule|after_hours_mode|services_offered|services_catalog|product_catalog|social_handles|agent_name|agent_tone|team_directory|faqs|unknown_answer_fallback|daily_bulletin|agent_tools|vertical|handoff_mode|business_locations|business_policies|alert_email|wallet_balance_kes|wallet_low_balance_kes|billing_enforcement|soft_spend_limit_enabled|soft_spend_limit_kes|on_demand_usage_enabled|sms_included_units|sms_used_units|column/i.test(
    message
  );
}

/**
 * Workspace data client:
 * - Supabase Auth owners → anon/SSR client (JWT + RLS)
 * - Legacy Super Admin cookie → service role (bypasses RLS for ops/demo desk)
 */
export const createWorkspaceDataClient = cache(async (): Promise<{
  client: SupabaseClient;
  mode: "owner" | "legacy";
} | null> => {
  const user = await getAuthUser();
  if (user) {
    return { client: await createSupabaseServerClient(), mode: "owner" };
  }
  if (await isLegacyAuthenticated()) {
    return { client: getSupabaseAdmin(), mode: "legacy" };
  }
  return null;
});

export type OwnerWorkspace = { id: string; business_name: string | null };

/** Memberships the signed-in owner can open. Oldest first. RLS only. */
export const listOwnerWorkspaces = cache(async (): Promise<OwnerWorkspace[]> => {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error || !data?.length) return [];
  const ids = data.map((row) => row.tenant_id).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  const tenants = await supabase.from("tenants").select("id, business_name").in("id", ids);
  if (tenants.error) return ids.map((id) => ({ id, business_name: null }));
  const names = new Map(
    (tenants.data || []).map((row) => [row.id as string, (row.business_name as string | null) || null])
  );
  return ids.map((id) => ({ id, business_name: names.get(id) || null }));
});

async function ownerTenantId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const ids = (data || [])
    .map((row) => row.tenant_id)
    .filter((id): id is string => Boolean(id));
  if (!ids.length) return null;
  const picked = (await cookies()).get(DESK_TENANT_COOKIE)?.value || "";
  if (picked && ids.includes(picked)) return picked;
  return ids[0];
}

const SHELL_SELECT =
  "id, business_name, vertical, services_offered, business_hours, agent_tone";

export type DeskShellTenant = {
  id: string;
  business_name: string;
  vertical: string | null;
  services_offered: string | null;
  business_hours: string | null;
  agent_tone: string | null;
  llm_system_prompt: string | null;
};

function shellProfileComplete(row: {
  services_offered?: string | null;
  business_hours?: string | null;
  agent_tone?: string | null;
}): boolean {
  return (
    Boolean(String(row.services_offered || "").trim()) &&
    Boolean(String(row.business_hours || "").trim()) &&
    Boolean(String(row.agent_tone || "").trim())
  );
}

/**
 * Chrome read. Name and vertical, plus the three profile fields the onboarding
 * gate can decide from. The prompt is loaded only when that profile is incomplete.
 */
export const getDeskShellTenant = cache(async (): Promise<DeskShellTenant | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createSupabaseServerClient();
  const tenantId = await ownerTenantId(supabase, user.id);
  if (!tenantId) return null;

  let { data, error } = await supabase
    .from("tenants")
    .select(SHELL_SELECT)
    .eq("id", tenantId)
    .maybeSingle();

  if (error && /vertical|services_offered|business_hours|agent_tone|column/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("tenants")
      .select("id, business_name")
      .eq("id", tenantId)
      .maybeSingle());
  }

  if (error) throw error;
  if (!data?.id) return null;

  const row = data as Partial<DeskShellTenant> & { id: string; business_name?: string | null };
  const shell: DeskShellTenant = {
    id: row.id,
    business_name: row.business_name || "",
    vertical: row.vertical ?? null,
    services_offered: row.services_offered ?? null,
    business_hours: row.business_hours ?? null,
    agent_tone: row.agent_tone ?? null,
    llm_system_prompt: null,
  };
  if (shellProfileComplete(shell)) return shell;

  const prompt = await supabase
    .from("tenants")
    .select("llm_system_prompt")
    .eq("id", tenantId)
    .maybeSingle();
  if (!prompt.error) {
    shell.llm_system_prompt = (prompt.data?.llm_system_prompt as string | null) ?? null;
  }
  return shell;
});

/** Resolve the signed-in user's tenant (via tenant_members), or legacy first-active. */
export const getCurrentTenant = cache(async (): Promise<TenantRow | null> => {
  const user = await getAuthUser();

  if (user) {
    // Owner path: Auth session client — RLS enforces membership.
    const supabase = await createSupabaseServerClient();
    const tenantId = await ownerTenantId(supabase, user.id);
    if (!tenantId) return null;

    let { data, error } = await supabase
      .from("tenants")
      .select(TENANT_SELECT)
      .eq("id", tenantId)
      .maybeSingle();

    if (error && isMissingGreetingIdentityColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("tenants")
        .select(TENANT_SELECT_NO_GREETING_IDENTITY)
        .eq("id", tenantId)
        .maybeSingle());
    }

    if (error && isMissingSmsAllowanceColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("tenants")
        .select(TENANT_SELECT_NO_SMS_ALLOWANCE)
        .eq("id", tenantId)
        .maybeSingle());
    }

    if (error && isMissingNotifyChannelsColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("tenants")
        .select(TENANT_SELECT_NO_NOTIFY_CHANNELS)
        .eq("id", tenantId)
        .maybeSingle());
    }

    if (error && isMissingSonioxVoiceColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("tenants")
        .select(TENANT_SELECT_NO_SONIOX_VOICE)
        .eq("id", tenantId)
        .maybeSingle());
    }

    if (error && isMissingProductSocialColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("tenants")
        .select(TENANT_SELECT_NO_PRODUCT_SOCIAL)
        .eq("id", tenantId)
        .maybeSingle());
    }

    if (error && isMissingTtsLexiconColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("tenants")
        .select(TENANT_SELECT_NO_TTS_LEXICON)
        .eq("id", tenantId)
        .maybeSingle());
    }

    if (error && isMissingSoftSpendLimitColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("tenants")
        .select(TENANT_SELECT_NO_SOFT_LIMIT)
        .eq("id", tenantId)
        .maybeSingle());
    }

    if (error && isMissingProfileColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("tenants")
        .select(TENANT_SELECT_LEGACY)
        .eq("id", tenantId)
        .maybeSingle());
    }

    if (error) throw error;
    return (data as TenantRow) || null;
  }

  // Legacy shared-password desk: first active tenant (ops/demo). Service role.
  if (await isLegacyAuthenticated()) {
    const admin = getSupabaseAdmin();
    let { data, error } = await admin
      .from("tenants")
      .select(TENANT_SELECT)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error && isMissingGreetingIdentityColumnError(error.message)) {
      ({ data, error } = await admin
        .from("tenants")
        .select(TENANT_SELECT_NO_GREETING_IDENTITY)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error && isMissingSmsAllowanceColumnError(error.message)) {
      ({ data, error } = await admin
        .from("tenants")
        .select(TENANT_SELECT_NO_SMS_ALLOWANCE)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error && isMissingNotifyChannelsColumnError(error.message)) {
      ({ data, error } = await admin
        .from("tenants")
        .select(TENANT_SELECT_NO_NOTIFY_CHANNELS)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error && isMissingSonioxVoiceColumnError(error.message)) {
      ({ data, error } = await admin
        .from("tenants")
        .select(TENANT_SELECT_NO_SONIOX_VOICE)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error && isMissingProductSocialColumnError(error.message)) {
      ({ data, error } = await admin
        .from("tenants")
        .select(TENANT_SELECT_NO_PRODUCT_SOCIAL)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error && isMissingTtsLexiconColumnError(error.message)) {
      ({ data, error } = await admin
        .from("tenants")
        .select(TENANT_SELECT_NO_TTS_LEXICON)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error && isMissingSoftSpendLimitColumnError(error.message)) {
      ({ data, error } = await admin
        .from("tenants")
        .select(TENANT_SELECT_NO_SOFT_LIMIT)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error && isMissingProfileColumnError(error.message)) {
      ({ data, error } = await admin
        .from("tenants")
        .select(TENANT_SELECT_LEGACY)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error) throw error;
    return (data as TenantRow) || null;
  }

  return null;
});

/** Claim next available DID from sautikit_did_pool (no-op if already assigned / pool empty). */
export async function assignDidFromPool(tenantId: string): Promise<string | null> {
  // Pool RPCs are privileged — always service role.
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("assign_did_from_pool", {
    p_tenant_id: tenantId,
  });
  if (error) {
    console.warn("[tenant] assign_did_from_pool:", error.message);
    return null;
  }
  return (data as string) || null;
}

/**
 * Fallback provisioner if the Auth trigger has not run yet (SQL not applied).
 * Idempotent — safe to call after every signup. Also retries DID pool assign.
 * Uses service role (bypasses RLS) intentionally.
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

  if (existing?.tenant_id) {
    await assignDidFromPool(existing.tenant_id);
    return existing.tenant_id;
  }

  const businessName = opts.businessName.trim();
  const phone = opts.notificationPhone.trim() || "pending";

  const row: Record<string, unknown> = {
    business_name: businessName,
    sautikit_virtual_number: `pending:${opts.userId}`,
    whatsapp_notification_number: phone,
    llm_system_prompt: defaultTenantLlmPrompt(businessName),
    is_active: true,
    wallet_balance_kes: 0,
    billing_enforcement: "off",
    telecom_wallet_balance_kes: 0,
    ai_wallet_balance_usd: 0,
  };

  const rowWithLangs = {
    ...row,
    voice_languages: ["en", "sw", "sheng"],
    voice_language_other: null,
  };

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

  if (tenantErr && /wallet_balance_kes/i.test(tenantErr.message)) {
    const { wallet_balance_kes: _drop, ...rowWithoutOneWallet } = row;
    void _drop;
    ({ data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .insert({ ...rowWithoutOneWallet, owner_user_id: opts.userId })
      .select("id")
      .single());
    if (tenantErr?.message?.toLowerCase().includes("owner_user_id")) {
      ({ data: tenant, error: tenantErr } = await admin
        .from("tenants")
        .insert(rowWithoutOneWallet)
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
