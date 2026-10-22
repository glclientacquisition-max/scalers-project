import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import type { SettingsHubRaw } from "@/lib/ops/settingsHubView";

const FULL =
  "voicemail_hold_days, shadow_invoices, billing_notices_send, desk_plan_change_enabled, new_signup_trial_enabled, package_editor_enabled, price_change_approval_threshold_kes, updated_at";
const BASE = "voicemail_hold_days, shadow_invoices, updated_at";

/** Settings hub (ADMIN_V2). Read-only. Newer columns are optional so an older schema still loads. */
export async function loadSettingsHub(): Promise<SettingsHubRaw | null> {
  const admin = getSupabaseAdmin();
  const full = await admin.from("billing_lifecycle_settings").select(FULL).eq("id", 1).maybeSingle();
  if (!full.error) return (full.data as SettingsHubRaw | null) ?? null;
  const base = await admin.from("billing_lifecycle_settings").select(BASE).eq("id", 1).maybeSingle();
  if (base.error) throw base.error;
  return (base.data as SettingsHubRaw | null) ?? null;
}
