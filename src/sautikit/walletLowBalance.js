// Phone wallet low-balance alerts (staff ops mail, not owner copy).
//
// Two inputs feed one evaluator:
//   * the 15 min wallet poll (walletProbe.js), source 'poll'
//   * the vendor wallet.low_balance webhook on /voice/events, source 'webhook'
//
// Thresholds: VOICE_WALLET_ALERT_THRESHOLDS_KES (default "500,100").
// Each threshold alerts once per downward crossing (balance <= threshold) and
// re-arms when a reading shows the balance above it again. One drop past
// several thresholds sends a single alert naming the lowest one.
//
// The crossing latch lives in Supabase (docs/supabase/voice_wallet_low_balance.sql)
// so a restart does not re-alert, and the webhook and the poll share it so the
// same crossing never alerts twice. If those objects are missing the process
// falls back to in-memory state and warns once.
//
// A balance-unknown reading (probe error, 402, timeout, missing field) never
// alerts and never re-arms.
//
// Zero or below: the wallet is empty and the existing "phone line down" alert
// (walletProbe, with the cause named) is the ONE alert for that reading. Here
// we still claim every threshold silently, so a drop from above 500 straight to
// 0 never fires "wallet low" later on the same drop.
//
// The webhook input is inert unless VOICE_WALLET_WEBHOOK=on: the route still
// answers 200 and ignores the body. It waits on confirming how the vendor signs
// workspace webhooks (see docs/ops/wallet-low-balance-alert.md).

const {
  sendPlatformOpsNotice,
} = require('../notifications/platformOpsAlert');
const { platformOpsKindEnabled } = require('../notifications/platformOpsRecipients');

const DEFAULT_THRESHOLDS_KES = [500, 100];
const ADMIN_KIND = 'sautikit_low';
const EVENT_LRU_MAX = 1000;

let storeOverride = null;
let dbClientOverride = null;
let memory = null;
let dbStore = null;
let dbUnavailable = false;
let warnedFallback = false;

/**
 * @param {string|undefined} raw e.g. "500,100"
 * @returns {number[]} thresholds in minor units, highest first
 */
function parseThresholdsKes(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return DEFAULT_THRESHOLDS_KES.map((k) => k * 100);
  const out = new Set();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const kes = Number(part);
    if (!Number.isFinite(kes) || kes <= 0) {
      console.warn(
        `[wallet-low] ignoring bad VOICE_WALLET_ALERT_THRESHOLDS_KES entry "${part.slice(0, 20)}"`
      );
      continue;
    }
    out.add(Math.round(kes * 100));
  }
  if (!out.size) return DEFAULT_THRESHOLDS_KES.map((k) => k * 100);
  return [...out].sort((a, b) => b - a);
}

function thresholdsMinor(env = process.env) {
  return parseThresholdsKes(env.VOICE_WALLET_ALERT_THRESHOLDS_KES);
}

function alertsOff(env = process.env) {
  return String(env.VOICE_WALLET_LOW_ALERT || 'on').toLowerCase() === 'off';
}

function webhookOn(env = process.env) {
  return String(env.VOICE_WALLET_WEBHOOK || 'off').toLowerCase() === 'on';
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  const n = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(n) ? n : null;
}

/** In-process store. Same rules as the SQL functions. */
function createMemoryStore() {
  /** @type {Map<number, { crossed: boolean, observedAt: number|null }>} */
  const rows = new Map();
  /** @type {Map<string, true>} */
  const events = new Map();
  return {
    kind: 'memory',
    async observe({ thresholds, balanceMinor, observedAt }) {
      const at = toMs(observedAt) ?? Date.now();
      const crossed = [];
      const rearmed = [];
      for (const t of thresholds) {
        const row = rows.get(t) || { crossed: false, observedAt: null };
        rows.set(t, row);
        if (row.observedAt != null && at < row.observedAt) continue; // stale reading
        if (row.crossed && balanceMinor > t) {
          row.crossed = false;
          rearmed.push(t);
        } else if (!row.crossed && balanceMinor <= t) {
          row.crossed = true;
          crossed.push(t);
        }
        row.observedAt = at;
      }
      return { crossed, rearmed };
    },
    async release(thresholds) {
      for (const t of thresholds) {
        const row = rows.get(t);
        if (row) row.crossed = false;
      }
    },
    async claimEvent(eventId) {
      if (events.has(eventId)) return false;
      events.set(eventId, true);
      if (events.size > EVENT_LRU_MAX) events.delete(events.keys().next().value);
      return true;
    },
    _rows: rows,
  };
}

function isMissingObject(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || error || '');
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    code === '42P01' ||
    /could not find the function|does not exist|schema cache/i.test(msg)
  );
}

class StoreMissingError extends Error {}

/**
 * Supabase-backed store via security-definer RPCs.
 * @param {{ rpc: Function }} client
 */
function createSupabaseStore(client) {
  async function call(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      if (isMissingObject(error)) throw new StoreMissingError(`${name}: ${error.message || error.code}`);
      throw new Error(`${name}: ${error.message || error.code || 'rpc failed'}`);
    }
    return data;
  }
  return {
    kind: 'supabase',
    async observe({ thresholds, balanceMinor, source, observedAt }) {
      const at = toMs(observedAt) ?? Date.now();
      const data = await call('voice_wallet_alert_observe', {
        p_thresholds: thresholds,
        p_balance_minor: Math.round(balanceMinor),
        p_source: source || null,
        p_observed_at: new Date(at).toISOString(),
      });
      const crossed = [];
      const rearmed = [];
      for (const row of Array.isArray(data) ? data : []) {
        const t = Number(row.threshold_minor);
        if (!Number.isFinite(t)) continue;
        if (row.action === 'crossed') crossed.push(t);
        else if (row.action === 'rearmed') rearmed.push(t);
      }
      return { crossed, rearmed };
    },
    async release(thresholds) {
      await call('voice_wallet_alert_release', { p_thresholds: thresholds });
    },
    async claimEvent(eventId, kind) {
      const data = await call('voice_webhook_event_claim', {
        p_event_id: eventId,
        p_kind: kind || null,
      });
      return data === true;
    },
  };
}

function memoryStore() {
  if (!memory) memory = createMemoryStore();
  return memory;
}

function defaultDbStore() {
  if (dbUnavailable) return null;
  if (dbStore) return dbStore;
  if (dbClientOverride) {
    dbStore = createSupabaseStore(dbClientOverride);
    return dbStore;
  }
  // Lazy: the shared client exits the process without Supabase env.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { supabase } = require('../lib/supabaseClient');
  dbStore = createSupabaseStore(supabase);
  return dbStore;
}

function noteFallback(err) {
  dbUnavailable = true;
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(
    `[wallet-low] crossing state table missing (${String(err?.message || err).slice(0, 160)}). ` +
      'Using in-process state: a restart can re-alert. Apply docs/supabase/voice_wallet_low_balance.sql.'
  );
}

/**
 * Run fn against the persistent store, or the memory store when it is not
 * configured or missing. Transient DB errors return { error } so callers can
 * skip the reading instead of guessing (guessing could double-alert).
 */
async function withStore(fn) {
  const primary = storeOverride || defaultDbStore();
  if (!primary) return { value: await fn(memoryStore()) };
  try {
    return { value: await fn(primary) };
  } catch (err) {
    if (err instanceof StoreMissingError && !storeOverride) {
      noteFallback(err);
      return { value: await fn(memoryStore()) };
    }
    return { error: err };
  }
}

/**
 * Evaluate one balance reading and alert on a new downward crossing.
 *
 * @param {{ balanceMinor: number|null|undefined, currency?: string|null, source: 'poll'|'webhook', observedAt?: number|string|Date, env?: NodeJS.ProcessEnv }} reading
 */
async function observeWalletBalance(reading = {}) {
  const env = reading.env || process.env;
  const balance = reading.balanceMinor == null ? NaN : Number(reading.balanceMinor);
  if (!Number.isFinite(balance)) return { ok: false, reason: 'balance_unknown' };
  if (alertsOff(env)) return { ok: false, reason: 'off' };

  let enabled = true;
  try {
    enabled = await platformOpsKindEnabled(ADMIN_KIND);
  } catch {
    enabled = true;
  }
  if (!enabled) return { ok: false, reason: 'disabled_in_admin' };

  const thresholds = thresholdsMinor(env);
  const source = reading.source || 'poll';
  const observed = await withStore((store) =>
    store.observe({
      thresholds,
      balanceMinor: balance,
      source,
      observedAt: reading.observedAt ?? Date.now(),
    })
  );
  if (observed.error) {
    console.warn(
      `[wallet-low] state unavailable, skipping reading source=${source}: ${String(
        observed.error.message || observed.error
      ).slice(0, 160)}`
    );
    return { ok: false, reason: 'state_unavailable' };
  }
  const { crossed, rearmed } = observed.value;
  if (rearmed.length) {
    console.log(`[wallet-low] re-armed thresholds=${rearmed.join(',')} source=${source}`);
  }
  if (!crossed.length) return { ok: true, alerted: false, crossed, rearmed };
  if (balance <= 0) {
    // Empty wallet: the phone-line-down alert names the cause. One mail only.
    console.warn(
      `[wallet-low] wallet empty; thresholds=${crossed.join(',')} marked crossed, line-down alert carries the cause source=${source}`
    );
    return { ok: true, alerted: false, suppressed: 'empty_wallet', crossed, rearmed };
  }

  const lowest = Math.min(...crossed);
  const currency = String(reading.currency || 'KES').trim() || 'KES';
  const sent = await sendPlatformOpsNotice('wallet', {
    balanceMinor: balance,
    currency,
    thresholdMinor: lowest,
    source: source === 'webhook' ? 'wallet webhook' : 'wallet check',
  });
  if (!sent.ok) {
    // Let the next reading try again rather than losing the alert.
    await withStore((store) => store.release(crossed));
    console.warn(
      `[wallet-low] alert not delivered (${sent.reason}); crossing released thresholds=${crossed.join(',')}`
    );
    return { ok: false, reason: sent.reason || 'not_sent', crossed, rearmed };
  }
  console.warn(
    `[wallet-low] crossing alerted thresholds=${crossed.join(',')} lowest=${lowest} source=${source} channel=${sent.channel}`
  );
  return { ok: true, alerted: true, crossed, rearmed, lowest, channel: sent.channel };
}

function headerValue(headers, name) {
  if (!headers) return '';
  const v = headers[name] ?? headers[name.toLowerCase()];
  return String(Array.isArray(v) ? v[0] : v || '').trim();
}

/**
 * Handle a wallet.* webhook (signature already checked by sautikitWebhookGuard).
 * Inert unless VOICE_WALLET_WEBHOOK=on.
 * Dedupe on event_id (body, then X-Sautikit-Event-Id, then
 * X-Sautikit-Idempotency-Key), then feed data.balance_minor into the shared evaluator.
 *
 * @param {{ headers?: object, body?: object, kind?: string, now?: number }} input
 */
async function handleWalletWebhookEvent({ headers = {}, body = {}, kind, now, env } = {}) {
  if (!webhookOn(env || process.env)) {
    console.log('[wallet-low] wallet webhook ignored (VOICE_WALLET_WEBHOOK is off; poll only)');
    return { ok: false, reason: 'webhook_off' };
  }
  const eventKind = String(kind || body.kind || headerValue(headers, 'x-sautikit-event') || '')
    .trim()
    .toLowerCase();
  const eventId =
    String(body.event_id || body.id || '').trim() ||
    headerValue(headers, 'x-sautikit-event-id') ||
    headerValue(headers, 'x-sautikit-idempotency-key');

  if (eventId) {
    const claimed = await withStore((store) => store.claimEvent(eventId, eventKind));
    // If the dedupe table is down, the crossing latch still stops a repeat.
    if (!claimed.error && claimed.value === false) {
      console.log(`[wallet-low] duplicate webhook event_id=${eventId.slice(0, 64)} ignored`);
      return { ok: false, reason: 'duplicate', eventId };
    }
  }

  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const balanceMinor =
    data.balance_minor != null ? Number(data.balance_minor) : null;
  const nowMs = now ?? Date.now();
  let observedAt = toMs(body.occurred_at) ?? nowMs;
  if (observedAt > nowMs) observedAt = nowMs;

  const out = await observeWalletBalance({
    balanceMinor: Number.isFinite(balanceMinor) ? balanceMinor : null,
    currency: data.currency || null,
    source: 'webhook',
    observedAt,
  });
  console.log(
    `[wallet-low] webhook kind=${eventKind || '?'} event_id=${(eventId || '-').slice(0, 64)} result=${
      out.alerted ? 'alerted' : out.reason || 'no_crossing'
    }`
  );
  return { ...out, eventId };
}

function isWalletEventKind(kind) {
  return /^wallet\./.test(String(kind || '').trim().toLowerCase());
}

/** Tests only. Drops process memory (simulates a restart). */
function resetWalletLowBalance({ keepStore = false } = {}) {
  memory = null;
  dbStore = null;
  dbUnavailable = false;
  warnedFallback = false;
  if (!keepStore) {
    storeOverride = null;
    dbClientOverride = null;
  }
}

/** Tests only: a fake Supabase client for the default (non-override) path. */
function setWalletLowBalanceDbClient(client) {
  dbClientOverride = client;
  dbStore = null;
  dbUnavailable = false;
}

/** Tests only. */
function setWalletLowBalanceStore(store) {
  storeOverride = store;
}

module.exports = {
  DEFAULT_THRESHOLDS_KES,
  parseThresholdsKes,
  thresholdsMinor,
  observeWalletBalance,
  handleWalletWebhookEvent,
  isWalletEventKind,
  webhookOn,
  createMemoryStore,
  createSupabaseStore,
  isMissingObject,
  resetWalletLowBalance,
  setWalletLowBalanceStore,
  setWalletLowBalanceDbClient,
};
