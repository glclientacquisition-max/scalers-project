import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import type { SettingsHubRaw } from "@/lib/ops/settingsHubView";

const HOLD = "hold_winback_enabled, number_hold_days, reactivation_fee_kes, updated_at";
const BASE = "updated_at";

/** Settings hub (ADMIN_V2). Read-only. Hold columns (#885) are optional so an older schema still loads. */
export async function loadSettingsHub(): Promise<SettingsHubRaw | null> {
  const admin = getSupabaseAdmin();
  const withHold = await admin.from("billing_lifecycle_settings").select(HOLD).eq("id", 1).maybeSingle();
  if (!withHold.error) return withHold.data ? { ...(withHold.data as SettingsHubRaw), holdColumns: true } : null;
  const base = await admin.from("billing_lifecycle_settings").select(BASE).eq("id", 1).maybeSingle();
  if (base.error) throw base.error;
  return base.data ? { ...(base.data as SettingsHubRaw), holdColumns: false } : null;
}
