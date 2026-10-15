// Soniox prepaid balance probe. Needs an org admin key (SONIOX_ADMIN_KEY,
// permission "Balance and spend"). Read-only: GET /v1/organization/balance.
// Autopay off with a prepaid balance counts as at risk (warn).

const SONIOX_ORG_BASE = 'https://api.soniox.com';
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

let last = {
  configured: false,
  state: 'unknown',
  balanceUsd: null,
  autopay: null,
  invoiceBilling: null,
  paymentError: null,
  checkedAt: null,
  error: null,
};

function numEnv(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(n) ? n : fallback;
}

function sonioxThresholds() {
  return {
    warnBelowUsd: numEnv('SONIOX_BALANCE_WARN_USD', 20),
    criticalAtOrBelowUsd: numEnv('SONIOX_BALANCE_CRITICAL_USD', 5),
  };
}

/** Pure: Soniox balance JSON → probe state. */
function classifySonioxBalance(json, thresholds = sonioxThresholds()) {
  const balance = Number(json?.available_balance_usd);
  const balanceUsd = Number.isFinite(balance) ? balance : null;
  const invoiceBilling = Boolean(json?.invoice_billing_enabled);
  const autopay = Boolean(json?.autopay_enabled);
  const paymentError = Boolean(json?.has_payment_error);
  let state = 'ok';
  let reason = null;
  if (json?.balance_exhausted) {
    state = 'exhausted';
    reason = 'Soniox balance is spent. Speech requests are refused.';
  } else if (!invoiceBilling && balanceUsd != null && balanceUsd <= thresholds.criticalAtOrBelowUsd) {
    state = 'critical';
    reason = `Soniox balance is $${balanceUsd}.`;
  } else if (paymentError) {
    state = 'critical';
    reason = 'Soniox last payment failed.';
  } else if (!invoiceBilling && balanceUsd != null && balanceUsd < thresholds.warnBelowUsd) {
    state = 'warn';
    reason = `Soniox balance is low ($${balanceUsd}).`;
  } else if (!invoiceBilling && !autopay) {
    state = 'warn';
    reason = 'Soniox autopay is off. Balance can run out without warning.';
  }
  return { state, reason, balanceUsd, autopay, invoiceBilling, paymentError };
}

async function probeSonioxBalance(opts = {}) {
  const key = String(opts.adminKey || process.env.SONIOX_ADMIN_KEY || '').trim();
  const checkedAt = new Date().toISOString();
  if (!key) {
    last = { ...last, configured: false, state: 'unknown', checkedAt, error: 'SONIOX_ADMIN_KEY not set' };
    return { ...last };
  }
  try {
    const res = await (opts.fetchImpl || fetch)(`${SONIOX_ORG_BASE}/v1/organization/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok || !json) {
      const error =
        res.status === 401 || res.status === 403
          ? `Soniox admin key refused (HTTP ${res.status}). Needs the Balance and spend permission.`
          : `Soniox balance check failed (HTTP ${res.status}).`;
      last = { ...last, configured: true, state: 'unknown', checkedAt, error };
      return { ...last };
    }
    const c = classifySonioxBalance(json);
    last = {
      configured: true,
      state: c.state,
      balanceUsd: c.balanceUsd,
      autopay: c.autopay,
      invoiceBilling: c.invoiceBilling,
      paymentError: c.paymentError,
      checkedAt,
      error: c.reason,
    };
    return { ...last };
  } catch (err) {
    last = {
      ...last,
      configured: true,
      state: 'unknown',
      checkedAt,
      error: `Soniox balance check failed: ${String(err?.message || err).slice(0, 120)}`,
    };
    return { ...last };
  }
}

function getSonioxBalanceHealth() {
  return { ...last, configured: Boolean(String(process.env.SONIOX_ADMIN_KEY || '').trim()) };
}

function sonioxBalanceProbeIntervalMs() {
  const n = numEnv('SONIOX_BALANCE_PROBE_MS', DEFAULT_INTERVAL_MS);
  return n >= 60_000 ? n : DEFAULT_INTERVAL_MS;
}

function startSonioxBalanceProbe() {
  if (!String(process.env.SONIOX_ADMIN_KEY || '').trim()) return null;
  const tick = () => {
    void probeSonioxBalance().catch((err) => {
      console.warn('[soniox-balance] probe error:', err?.message || err);
    });
  };
  tick();
  const timer = setInterval(tick, sonioxBalanceProbeIntervalMs());
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/** Tests only. */
function resetSonioxBalance() {
  last = {
    configured: false,
    state: 'unknown',
    balanceUsd: null,
    autopay: null,
    invoiceBilling: null,
    paymentError: null,
    checkedAt: null,
    error: null,
  };
}

module.exports = {
  classifySonioxBalance,
  probeSonioxBalance,
  getSonioxBalanceHealth,
  startSonioxBalanceProbe,
  sonioxBalanceProbeIntervalMs,
  resetSonioxBalance,
};
