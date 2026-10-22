/**
 * Payment runtime switches stored on billing_lifecycle_settings (P20).
 * Pure merge helpers; database reads live in each runtime.
 */

/** @typedef {'off' | 'sandbox' | 'live'} BachsPaymentsMode */

/**
 * @param {unknown} row
 * @returns {{
 *   available: boolean;
 *   bachsMode: BachsPaymentsMode;
 *   liveMaster: boolean;
 *   billingNoticesSend: boolean;
 *   deskPlanChangeEnabled: boolean;
 * } | null}
 */
function runtimeSettingsFromRow(row) {
  if (!row || typeof row !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (row);
  if (!("bachs_payments_mode" in r)) return null;
  const modeRaw = String(r.bachs_payments_mode ?? "off").trim().toLowerCase();
  /** @type {BachsPaymentsMode} */
  const bachsMode =
    modeRaw === "sandbox" || modeRaw === "live" ? modeRaw : "off";
  return {
    available: true,
    bachsMode,
    liveMaster: r.live_payments_master === true,
    billingNoticesSend: r.billing_notices_send === true,
    deskPlanChangeEnabled: r.desk_plan_change_enabled === true,
  };
}

/**
 * @param {NodeJS.ProcessEnv} base
 * @param {ReturnType<typeof runtimeSettingsFromRow>} settings
 * @returns {NodeJS.ProcessEnv}
 */
function overlayRuntimeEnv(base, settings) {
  if (!settings?.available) return base;
  const out = { ...base };
  out.BACHS_MODE = settings.bachsMode;
  out.BACHS_LIVE_ALLOWED = settings.liveMaster ? "true" : "false";
  out.BILLING_NOTICES_SEND = settings.billingNoticesSend ? "on" : "off";
  out.DESK_PLAN_CHANGE = settings.deskPlanChangeEnabled ? "on" : "off";
  return out;
}

module.exports = {
  runtimeSettingsFromRow,
  overlayRuntimeEnv,
};
