import { getSupabaseAdmin } from "@/lib/supabase";

export type BachsPaymentsMode = "off" | "sandbox" | "live";

export type BillingRuntimeSettings = {
  available: boolean;
  bachsMode: BachsPaymentsMode;
  liveMaster: boolean;
  billingNoticesSend: boolean;
  deskPlanChangeEnabled: boolean;
};

function schemaMiss(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST116" || code === "42703") return true;
  return String(error.message || "").toLowerCase().includes("does not exist");
}

function runtimeSettingsFromRow(row: unknown): BillingRuntimeSettings | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!("bachs_payments_mode" in r)) return null;
  const modeRaw = String(r.bachs_payments_mode ?? "off").trim().toLowerCase();
  const bachsMode: BachsPaymentsMode =
    modeRaw === "sandbox" || modeRaw === "live" ? modeRaw : "off";
  return {
    available: true,
    bachsMode,
    liveMaster: r.live_payments_master === true,
    billingNoticesSend: r.billing_notices_send === true,
    deskPlanChangeEnabled: r.desk_plan_change_enabled === true,
  };
}

export function overlayRuntimeEnv(
  base: NodeJS.ProcessEnv,
  settings: BillingRuntimeSettings | null,
): NodeJS.ProcessEnv {
  if (!settings?.available) return base;
  return {
    ...base,
    BACHS_MODE: settings.bachsMode,
    BACHS_LIVE_ALLOWED: settings.liveMaster ? "true" : "false",
    BILLING_NOTICES_SEND: settings.billingNoticesSend ? "on" : "off",
    DESK_PLAN_CHANGE: settings.deskPlanChangeEnabled ? "on" : "off",
  };
}

/** Loads P20 switches. When columns are missing, returns null and callers use process env. */
export async function loadBillingRuntimeSettings(): Promise<BillingRuntimeSettings | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("billing_lifecycle_settings")
    .select(
      "bachs_payments_mode, live_payments_master, billing_notices_send, desk_plan_change_enabled",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (schemaMiss(error)) return null;
    throw error;
  }
  return runtimeSettingsFromRow(data);
}

/** Effective env for payment gates: DB switches overlay hosting secrets and URLs. */
export async function effectivePaymentEnv(
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const settings = await loadBillingRuntimeSettings();
  return overlayRuntimeEnv(base, settings);
}
