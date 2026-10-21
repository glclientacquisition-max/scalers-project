const { runtimeSettingsFromRow, overlayRuntimeEnv } = require("./billingRuntimeSettings");

function schemaMiss(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST116" || code === "42703") return true;
  return String(error.message || "").toLowerCase().includes("does not exist");
}

/** @param {import('@supabase/supabase-js').SupabaseClient} admin */
async function loadBillingRuntimeSettings(admin) {
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

/**
 * @param {NodeJS.ProcessEnv} base
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
async function effectivePaymentEnv(base, admin) {
  const settings = await loadBillingRuntimeSettings(admin);
  return overlayRuntimeEnv(base, settings);
}

module.exports = {
  loadBillingRuntimeSettings,
  effectivePaymentEnv,
};
