// Process-wide telephony edge health (SautiKit wallet / API). Exposed on GET /healthz.

/** @type {{ billingExhausted: boolean, balanceMinor: number|null, currency: string|null, message: string|null, at: string|null }} */
let last = {
  billingExhausted: false,
  balanceMinor: null,
  currency: null,
  message: null,
  at: null,
};

function snapshot(partial = {}) {
  last = {
    billingExhausted: Boolean(partial.billingExhausted),
    balanceMinor:
      partial.balanceMinor == null ? null : Number(partial.balanceMinor),
    currency: partial.currency ? String(partial.currency) : null,
    message: partial.message ? String(partial.message).slice(0, 200) : null,
    at: new Date().toISOString(),
  };
  return last;
}

function getTelephonyProviderHealth() {
  return { ...last };
}

function isTelephonyBillingExhausted() {
  return Boolean(last.billingExhausted);
}

/** Tests only. */
function resetTelephonyProviderHealth() {
  last = {
    billingExhausted: false,
    balanceMinor: null,
    currency: null,
    message: null,
    at: null,
  };
}

module.exports = {
  snapshot,
  getTelephonyProviderHealth,
  isTelephonyBillingExhausted,
  resetTelephonyProviderHealth,
};
