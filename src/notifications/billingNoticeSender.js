'use strict';

const SUPABASE_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

// Billing notice sender (#775 billing_notices outbox) on the Railway server.
//
// claim_billing_notices -> dispatchAlert (normal SMS / WhatsApp / email path,
// billed to the platform because every kind is platform_billing_*) ->
// settle_billing_notice. NOT gated by tenant_escalation_allowed: a business
// that is out of usage must still hear "trial ended" / "line suspended".
//
// Idempotent: the claim flips pending -> sending under SKIP LOCKED, so two
// servers never take the same row; the notify ledger key is per notice
// (keyBase billing_notice:<tenant>:<idempotency_key>), so a replay never
// sends twice. One attempt per notice per claim: a failure settles 'failed'
// and is not retried by this loop.
//
// Off unless BILLING_NOTICES_SEND=on. Missing RPCs (#775 not applied) log once
// and back off. Logs ids, kinds and counts only (never recipient or body).
// No Vercel cron: Hobby runs crons once a day.

const TAG = '[billing-notices]';
const DEFAULT_INTERVAL_MS = 2 * 60_000;
const MIN_INTERVAL_MS = 30_000;
const DEFAULT_LIMIT = 20;
const FIRST_RUN_DELAY_MS = 60_000;
const DEFAULT_MISSING_BACKOFF_MS = 30 * 60_000;
const SKIP_REASONS = new Set(['no_destination_number', 'no_recipient', 'channels_disabled_by_tenant']);
const REPLAY_REASONS = new Set(['instance_already_sent', 'already_sent']);

function on(value) {
  return ['on', '1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function billingNoticeConfig(env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'test') return null;
  if (!on(env.BILLING_NOTICES_SEND)) return null;
  const rawMs = Number(env.BILLING_NOTICES_INTERVAL_MS);
  const intervalMs = Number.isFinite(rawMs) && rawMs > 0 ? Math.max(MIN_INTERVAL_MS, Math.floor(rawMs)) : DEFAULT_INTERVAL_MS;
  const rawLimit = Number(env.BILLING_NOTICES_BATCH);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(100, Math.floor(rawLimit)) : DEFAULT_LIMIT;
  return { intervalMs, limit };
}

/** Start at the channel enqueue_billing_notice chose; fall back in dispatch order. */
function channelsForNotice(row) {
  const ch = String(row?.channel || '').toLowerCase();
  if (ch === 'email') return { sms: false, whatsapp: false, email: true };
  if (ch === 'whatsapp') return { sms: false, whatsapp: true, email: true };
  return { sms: true, whatsapp: true, email: true };
}

function isMissingRpc(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === 'PGRST202' || code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(String(error.message || ''));
}

function sendOptions(row) {
  const fb = row.fallback && typeof row.fallback === 'object' ? row.fallback : {};
  const phone = fb.sms || fb.whatsapp || (row.channel !== 'email' ? row.recipient : null) || null;
  const email = fb.email || (row.channel === 'email' ? row.recipient : null) || null;
  const body = row.title ? `${row.title}\n\n${row.body}` : row.body;
  return {
    to: phone,
    email,
    body,
    subject: row.title || 'Billing notice',
    channels: channelsForNotice(row),
    kind: row.kind,
    ledger: {
      tenantId: row.tenant_id,
      kind: row.kind,
      keyBase: `billing_notice:${row.tenant_id}:${row.idempotency_key}`,
      billingNotice: true,
    },
  };
}

function settleFor(result, threw) {
  if (threw) return { status: 'failed', error: 'send_error' };
  if (result && result.channel) return { status: 'sent', error: null };
  const reason = String(result?.reason || 'send_failed');
  if (REPLAY_REASONS.has(reason)) return { status: 'sent', error: null };
  if (SKIP_REASONS.has(reason)) return { status: 'skipped', error: reason };
  return { status: 'failed', error: reason.slice(0, 80) };
}

function createBillingNoticeSender({
  rpc,
  send,
  log = (m) => console.warn(m),
  now = () => Date.now(),
  limit = DEFAULT_LIMIT,
  missingBackoffMs = DEFAULT_MISSING_BACKOFF_MS,
} = {}) {
  let running = false;
  let missingUntil = 0;

  async function settle(row, outcome) {
    try {
      const res = await rpc('settle_billing_notice', {
        p_id: row.id,
        p_status: outcome.status,
        p_notify_send_id: null,
        p_error: outcome.error,
      });
      if (res?.error) log(`${TAG} settle failed id=${row.id} (${res.error.code || 'error'})`);
    } catch (err) {
      log(`${TAG} settle failed id=${row.id} (${err?.name || 'Error'})`);
    }
  }

  async function runOnce() {
    if (running) return { skipped: 'in_flight' };
    if (missingUntil && now() < missingUntil) return { skipped: 'rpc_missing' };
    running = true;
    try {
      let res;
      try {
        res = await rpc('claim_billing_notices', { p_limit: limit });
      } catch (err) {
        res = { data: null, error: { message: err?.message || String(err) } };
      }
      if (res?.error) {
        if (isMissingRpc(res.error)) {
          missingUntil = now() + missingBackoffMs;
          log(`${TAG} claim_billing_notices missing (#775 not applied); backing off`);
          return { skipped: 'rpc_missing' };
        }
        log(`${TAG} claim failed (${res.error.code || 'error'})`);
        return { skipped: 'claim_failed' };
      }
      const rows = Array.isArray(res?.data) ? res.data : [];
      const counts = { claimed: rows.length, sent: 0, failed: 0, skipped: 0 };
      for (const row of rows) {
        if (!row || !row.id) continue;
        let result = null;
        let threw = false;
        try {
          result = await send(sendOptions(row));
        } catch {
          threw = true;
        }
        const outcome = settleFor(result, threw);
        counts[outcome.status] += 1;
        if (outcome.status !== 'sent') {
          log(`${TAG} ${outcome.status} id=${row.id} kind=${row.kind} (${outcome.error})`);
        }
        await settle(row, outcome);
      }
      if (rows.length) {
        log(`${TAG} claimed=${counts.claimed} sent=${counts.sent} failed=${counts.failed} skipped=${counts.skipped}`);
      }
      return counts;
    } finally {
      running = false;
    }
  }

  return { runOnce };
}

function defaultRpc() {
  // Same vars src/lib/supabaseClient.js needs (it exits without them).
  if (!SUPABASE_VARS.every((k) => process.env[k])) return null;
  const { supabase } = require('../lib/supabaseClient');
  return (name, args) => supabase.rpc(name, args);
}

function startBillingNoticeSender({
  env = process.env,
  rpc = null,
  send = null,
  log = (m) => console.log(m),
  timers = globalThis,
} = {}) {
  const config = billingNoticeConfig(env);
  if (!config) return null;
  const call = rpc || defaultRpc();
  if (!call) {
    log(`${TAG} off: Supabase is not configured`);
    return null;
  }
  const sender = createBillingNoticeSender({
    rpc: call,
    send: send || ((opts) => require('./dispatch').dispatchAlert(opts)),
    log,
    limit: config.limit,
  });
  const tick = () => {
    sender.runOnce().catch((err) => log(`${TAG} tick failed (${err?.name || 'Error'})`));
  };
  const first = timers.setTimeout(tick, FIRST_RUN_DELAY_MS);
  first?.unref?.();
  const every = timers.setInterval(tick, config.intervalMs);
  every?.unref?.();
  log(`${TAG} on, every ${Math.round(config.intervalMs / 1000)} s, batch ${config.limit}`);
  return {
    runOnce: sender.runOnce,
    stop() {
      timers.clearTimeout(first);
      timers.clearInterval(every);
    },
  };
}

module.exports = {
  billingNoticeConfig,
  channelsForNotice,
  createBillingNoticeSender,
  startBillingNoticeSender,
};
