'use strict';

const SUPABASE_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

// Short call link for staff SMS: app.scalers.co.ke/c/<code> (#777).
//
// calls.short_code is filled by supabase/migrations/20261018230000_call_short_code.sql
// (random 7 chars, not derived from the call id). Until that migration is
// applied, or when the lookup fails, the SMS goes out without a link.
// Never throws; waits at most 1.5s for one indexed row read.

const TAG = '[call-short-link]';
const { SHORT_CODE_RE } = require('./templates');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_MISSING_BACKOFF_MS = 10 * 60_000;
const CACHE_MAX = 500;
const LOOKUP_TIMEOUT_MS = 1500;

function isShortCode(code) {
  return SHORT_CODE_RE.test(String(code || ''));
}

function isMissingColumn(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42703' || code === 'PGRST204') return true;
  return /short_code/i.test(String(error.message || '')) && /does not exist|schema cache|could not find/i.test(String(error.message || ''));
}

/**
 * @param {{ select?: (by: { column: string, value: string }) => Promise<{ data?: any, error?: any }>, log?: Function, now?: Function, missingBackoffMs?: number, timeoutMs?: number }} opts
 */
function createShortCodeLookup({
  select,
  log = (m) => console.warn(m),
  now = () => Date.now(),
  missingBackoffMs = DEFAULT_MISSING_BACKOFF_MS,
  timeoutMs = LOOKUP_TIMEOUT_MS,
} = {}) {
  const cache = new Map(); // key -> code
  let missingUntil = 0;

  async function lookup({ callId, callSid } = {}) {
    if (typeof select !== 'function') return null;
    if (missingUntil && now() < missingUntil) return null;
    const id = String(callId || '').trim();
    const sid = String(callSid || '').trim();
    const by = UUID_RE.test(id)
      ? { column: 'id', value: id }
      : sid
        ? { column: 'sautikit_call_sid', value: sid }
        : null;
    if (!by) return null;
    const key = `${by.column}:${by.value}`;
    if (cache.has(key)) return cache.get(key);
    let res;
    let timer;
    try {
      res = await Promise.race([
        select(by),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ data: null, error: { code: 'timeout', message: 'timeout' } }), timeoutMs);
        }),
      ]);
    } catch (err) {
      res = { data: null, error: { message: err?.message || String(err) } };
    } finally {
      clearTimeout(timer);
    }
    const error = res?.error || null;
    if (error) {
      if (isMissingColumn(error)) {
        missingUntil = now() + missingBackoffMs;
        log(`${TAG} calls.short_code missing (migration not applied); SMS without link`);
      } else {
        log(`${TAG} lookup failed (${error.code || 'error'}); SMS without link`);
      }
      return null;
    }
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const code = row && isShortCode(row.short_code) ? row.short_code : null;
    if (code) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, code);
    }
    return code;
  }

  return { lookup };
}

let defaultLookup = null;
let injectedLookup = null;

function supabaseSelect() {
  // Same vars src/lib/supabaseClient.js needs (it exits without them).
  if (!SUPABASE_VARS.every((k) => process.env[k])) return null;
  const { supabase } = require('../lib/supabaseClient');
  return ({ column, value }) =>
    supabase.from('calls').select('short_code').eq(column, value).limit(1).maybeSingle();
}

/** Short code for the call on this ledger, or null (no link). Never throws. */
async function callShortCode(ledger) {
  if (!ledger || typeof ledger !== 'object') return null;
  try {
    const l = injectedLookup || defaultLookup || (defaultLookup = createShortCodeLookup({ select: supabaseSelect() }));
    return await l.lookup({ callId: ledger.callId, callSid: ledger.callSid });
  } catch (err) {
    console.warn(`${TAG} lookup threw (${err?.message || err}); SMS without link`);
    return null;
  }
}

/** Tests only: swap the lookup used by dispatch (null restores the default). */
function setShortCodeLookup(lookup) {
  injectedLookup = lookup || null;
}

module.exports = {
  SHORT_CODE_RE,
  callShortCode,
  createShortCodeLookup,
  isShortCode,
  setShortCodeLookup,
};
