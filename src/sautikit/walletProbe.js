// Probe SautiKit prepaid wallet. Empty balance or HTTP 402 marks billing
// exhausted, and POST / /voice/incoming then return <Reject/> before Stream.
// Other probe HTTP errors (including 403), timeouts, and never-probed state
// do not. The probe key must be able to read GET /v1/wallet or that gate
// never fires. A later healthy probe clears the flag so calls resume without
// a restart.

const DEFAULT_API_BASE = 'https://api.sautikit.com';
const {
  snapshot,
  getTelephonyProviderHealth,
  isTelephonyBillingExhausted,
} = require('./telephonyProviderHealth');
const {
  notePlatformOpsDegrade,
  notePlatformOpsRecovered,
} = require('../notifications/platformOpsAlert');

function apiBase(value) {
  return String(value || process.env.SAUTIKIT_API_BASE || DEFAULT_API_BASE).replace(
    /\/$/,
    ''
  );
}

function parseWalletJson(json) {
  const data = json?.data && typeof json.data === 'object' ? json.data : json;
  if (!data || typeof data !== 'object') return null;
  const currency = String(data.currency || data.currency_code || 'KES').trim();
  const minor =
    data.balance_minor != null
      ? Number(data.balance_minor)
      : data.balance != null
        ? Number(data.balance)
        : null;
  return { currency, balanceMinor: Number.isFinite(minor) ? minor : null };
}

function classifyWalletResponse(status, json, text) {
  if (status === 402) {
    return {
      billingExhausted: true,
      balanceMinor: null,
      currency: null,
      message: String(json?.message || text || 'payment required').slice(0, 200),
    };
  }
  // Auth and other probe failures stay "not exhausted". A 403 must not Reject
  // every DID; fix the probe key so empty/402 can be seen.
  if (!status || status < 200 || status >= 300) {
    return {
      billingExhausted: false,
      balanceMinor: null,
      currency: null,
      message: `wallet probe HTTP ${status}`,
    };
  }
  const wallet = parseWalletJson(json);
  if (!wallet) {
    return {
      billingExhausted: false,
      balanceMinor: null,
      currency: null,
      message: 'wallet probe empty body',
    };
  }
  const exhausted = wallet.balanceMinor != null && wallet.balanceMinor <= 0;
  return {
    billingExhausted: exhausted,
    balanceMinor: wallet.balanceMinor,
    currency: wallet.currency,
    message: exhausted ? 'telephony wallet empty' : 'ok',
  };
}

/**
 * @param {{ fetchImpl?: typeof fetch, apiKey?: string }} [opts]
 */
async function probeSautikitWallet(opts = {}) {
  const apiKey = String(opts.apiKey || process.env.SAUTIKIT_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, reason: 'not_configured', health: getTelephonyProviderHealth() };
  }
  const fetchImpl = opts.fetchImpl || fetch;
  const base = apiBase();
  let status = 0;
  let json = null;
  let text = '';
  try {
    const res = await fetchImpl(`${base}/v1/wallet`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    status = res.status;
    text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
  } catch (err) {
    snapshot({
      billingExhausted: false,
      message: String(err?.message || err).slice(0, 200),
    });
    return { ok: false, reason: 'fetch_failed', health: getTelephonyProviderHealth() };
  }

  const wasExhausted = isTelephonyBillingExhausted();
  const next = classifyWalletResponse(status, json, text);
  snapshot(next);

  if (next.billingExhausted && !wasExhausted) {
    void notePlatformOpsDegrade('telephony', {
      message: next.message,
      balanceMinor: next.balanceMinor,
      currency: next.currency,
    }).catch((err) => {
      console.warn('[telephony] platform ops alert failed:', err?.message || err);
    });
  } else if (!next.billingExhausted && wasExhausted) {
    notePlatformOpsRecovered('telephony');
  }

  return {
    ok: true,
    status,
    billingExhausted: next.billingExhausted,
    health: getTelephonyProviderHealth(),
  };
}

function telephonyProbeIntervalMs() {
  const n = Number(process.env.VOICE_TELEPHONY_WALLET_PROBE_MS || 15 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000;
}

function startTelephonyWalletProbe() {
  if (String(process.env.VOICE_TELEPHONY_WALLET_PROBE || 'on').toLowerCase() === 'off') {
    return null;
  }
  const tick = () => {
    void probeSautikitWallet().catch((err) => {
      console.warn('[telephony] wallet probe error:', err?.message || err);
    });
  };
  tick();
  return setInterval(tick, telephonyProbeIntervalMs());
}

module.exports = {
  probeSautikitWallet,
  classifyWalletResponse,
  startTelephonyWalletProbe,
  telephonyProbeIntervalMs,
};
