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

/** Same Reject document as the package gate and an unknown DID. */
const TELEPHONY_BILLING_REJECT_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';

/**
 * XML to return from POST /voice/incoming when the wallet probe has marked
 * prepaid billing exhausted (empty balance or HTTP 402). Null means the
 * webhook may still open Stream. Probe HTTP errors such as 403 do not set
 * the flag, so this stays null until the probe key can read the wallet.
 */
function telephonyBillingRejectXml() {
  if (!isTelephonyBillingExhausted()) return null;
  return TELEPHONY_BILLING_REJECT_XML;
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
  telephonyBillingRejectXml,
  resetTelephonyProviderHealth,
};
