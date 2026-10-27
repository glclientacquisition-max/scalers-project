'use strict';

// POST {SAUTIKIT_API_BASE}/v1/calls/{call_id}/hangup
// https://sautikit.com/developers/api/hangupCall: "Requests termination of an
// in-progress call via the PBX ... Idempotent: if the PBX reports the call
// already ended, the request still succeeds." call_id may be the SautiKit
// call UUID or the PBX session id (HD_...), which is our callSid.
// Used only by VOICE_END_CALL_HONOUR (src/speech/endCallHonour.js).

const DEFAULT_API_BASE = 'https://api.sautikit.com';

// A key without call-control scope answers 401/403 every time. Log once and
// stop calling for a while; the media close still ends our side.
const SCOPE_DENIED_TTL_MS = 60 * 60 * 1000;
let scopeDeniedUntil = 0;
let scopeDeniedLogged = false;

function apiBase(value) {
  return String(value || process.env.SAUTIKIT_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
}

function resetHangupScopeLatch() {
  scopeDeniedUntil = 0;
  scopeDeniedLogged = false;
}

/**
 * @param {string} callSid  SautiKit call UUID or PBX session id (HD_...)
 * @param {{ apiKey?: string, apiBase?: string, fetchImpl?: typeof fetch, timeoutMs?: number, now?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status: number|string, reason?: string }>}
 */
async function hangupSautikitCall(callSid, opts = {}) {
  const id = String(callSid || '').trim();
  if (!id || id === 'unknown') return { ok: false, status: 'skipped', reason: 'no_call_sid' };
  const apiKey = String(opts.apiKey || process.env.SAUTIKIT_API_KEY || '').trim();
  if (!apiKey) return { ok: false, status: 'skipped', reason: 'no_api_key' };
  const at = Number.isFinite(opts.now) ? opts.now : Date.now();
  if (scopeDeniedUntil > at) return { ok: false, status: 'skipped', reason: 'scope_denied' };
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, status: 'skipped', reason: 'no_fetch' };
  const url = `${apiBase(opts.apiBase)}/v1/calls/${encodeURIComponent(id)}/hangup`;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), Number(opts.timeoutMs) || 2000) : null;
  if (timer && typeof timer.unref === 'function') timer.unref();
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ctl ? ctl.signal : undefined,
    });
    const status = Number(res?.status) || 0;
    if (status === 401 || status === 403) {
      scopeDeniedUntil = at + SCOPE_DENIED_TTL_MS;
      if (!scopeDeniedLogged) {
        scopeDeniedLogged = true;
        console.warn(
          `[sautikit] call hangup denied status=${status}: SAUTIKIT_API_KEY lacks call-control scope; media close only.`
        );
      }
      return { ok: false, status, reason: 'scope_denied' };
    }
    if (status === 404) return { ok: false, status, reason: 'not_found' };
    if (status >= 200 && status < 300) return { ok: true, status };
    return { ok: false, status, reason: 'http_error' };
  } catch (err) {
    return { ok: false, status: 'error', reason: err?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { hangupSautikitCall, resetHangupScopeLatch, DEFAULT_API_BASE };
