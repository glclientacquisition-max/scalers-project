'use strict';
// Voice-side trigger for Desk's platform ops alert check (#772,
// GET /api/cron/ops-alerts). Vercel Hobby crons run once a day at most, so
// Voice, which is up around the clock, calls the endpoint every 10 minutes.
//
// Off unless BOTH a URL (OPS_ALERTS_CRON_URL, or DESK_BASE_URL + the path) and
// CRON_SECRET (16+ characters, the same rule as the endpoint) are set.
// OPS_ALERTS_CRON=off turns it off. Never runs under NODE_ENV=test.
// One run at a time, a timeout, no retries (the next tick is the retry).
// Logs the HTTP status and counts only: never the secret, the URL or the body.
// Harmless when the endpoint is missing (404) or refuses (401).

const PATH = '/api/cron/ops-alerts';
const DEFAULT_INTERVAL_MS = 10 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const FIRST_RUN_DELAY_MS = 90_000;
const COUNT_KEYS = ['opened', 'resolved', 'sent', 'wouldSend', 'failed', 'recipients'];
const TAG = '[ops-alerts-cron]';

function safeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  return u.toString();
}

/** Config, or null when the trigger is off. */
function opsCronConfig(env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'test') return null;
  const flag = String(env.OPS_ALERTS_CRON || '').trim().toLowerCase();
  if (['off', '0', 'false', 'no'].includes(flag)) return null;
  const secret = String(env.CRON_SECRET || '');
  if (secret.length < 16) return null;
  let url = null;
  if (String(env.OPS_ALERTS_CRON_URL || '').trim()) url = safeUrl(env.OPS_ALERTS_CRON_URL);
  else if (String(env.DESK_BASE_URL || '').trim()) url = safeUrl(`${String(env.DESK_BASE_URL).trim().replace(/\/+$/, '')}${PATH}`);
  if (!url) return null;
  const n = Number(env.OPS_ALERTS_CRON_INTERVAL_MS);
  const intervalMs = Number.isFinite(n) && n > 0 ? Math.max(MIN_INTERVAL_MS, Math.round(n)) : DEFAULT_INTERVAL_MS;
  return { url, secret, intervalMs, timeoutMs: DEFAULT_TIMEOUT_MS };
}

function countsLine(body) {
  if (!body || typeof body !== 'object') return '';
  const parts = [];
  if (typeof body.dryRun === 'boolean') parts.push(`dryRun=${body.dryRun}`);
  for (const key of COUNT_KEYS) {
    const v = body[key];
    if (typeof v === 'number' && Number.isFinite(v)) parts.push(`${key}=${v}`);
  }
  return parts.join(' ');
}

/** One runner per config: runOnce() never overlaps and never retries. */
function createOpsCronRunner(config, { fetchImpl = globalThis.fetch, log = console.log } = {}) {
  let running = false;
  async function runOnce() {
    if (running) return { skipped: 'in_flight' };
    running = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs || DEFAULT_TIMEOUT_MS);
    timer.unref?.();
    try {
      const res = await fetchImpl(config.url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.secret}` },
        signal: controller.signal,
      });
      const status = Number(res?.status) || 0;
      let counts = '';
      if (status >= 200 && status < 300) {
        const body = await res.json().catch(() => null);
        counts = countsLine(body);
      }
      log(`${TAG} status=${status}${counts ? ` ${counts}` : ''}`);
      return { status };
    } catch (err) {
      const timeout = controller.signal.aborted || err?.name === 'AbortError';
      log(`${TAG} ${timeout ? 'timeout' : 'request failed'}${timeout ? '' : ` (${String(err?.name || 'Error')})`}`);
      return { error: true, timeout };
    } finally {
      clearTimeout(timer);
      running = false;
    }
  }
  return { runOnce };
}

/**
 * Start the 10-minute trigger. Returns null when off. Timers are unref()d so
 * they never hold the process open on shutdown.
 */
function startOpsAlertsCron({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, timers = globalThis } = {}) {
  const config = opsCronConfig(env);
  if (!config) return null;
  const runner = createOpsCronRunner(config, { fetchImpl, log });
  const tick = () => {
    runner.runOnce().catch(() => {});
  };
  const first = timers.setTimeout(tick, FIRST_RUN_DELAY_MS);
  first?.unref?.();
  const every = timers.setInterval(tick, config.intervalMs);
  every?.unref?.();
  log(`${TAG} on, every ${Math.round(config.intervalMs / 60_000)} min`);
  return {
    runOnce: runner.runOnce,
    stop() {
      timers.clearTimeout(first);
      timers.clearInterval(every);
    },
  };
}

module.exports = { opsCronConfig, createOpsCronRunner, startOpsAlertsCron, countsLine };
