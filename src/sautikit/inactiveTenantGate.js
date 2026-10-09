'use strict';

// Inbound gate for a business that is archived or suspended.
//
// A tenant row with is_active = false, or archived (archived_at set, Super
// Admin Archive, #636), still owns its DID row until the number is released.
// resolveTenantId matched that DID by exact number and the call was answered:
// Stream opened, the model and speech ran, minutes were metered, and a
// dead tenant's setup could look like an outage. The call must not be taken.
//
// At POST /voice/incoming, before Stream and before the call row: if every
// tenant row that owns the dialled number is inactive or archived, return a
// short "line unavailable" message and hang up. No /ws/media, no call row,
// no minutes, no outage alert. Any lookup error fails open (the gate never
// blocks a live business because the database blinked).
//
// The message: <Play> of the en and sw clips when allow-listed CDN URLs are
// configured (VOICE_LINE_UNAVAILABLE_CLIP_URL_EN / _SW), else <Say> with the
// same short copy. Generic copy: no business or agent name.
//
// Clip fallback. SautiKit reports no Play failure to us: a <Play> URL it
// cannot fetch (host not on the workspace CDN allow-list, expired presigned
// link, 404) is just silence before <Hangup/>. So a clip is only used when
//   - the var is an https URL,
//   - its host is in VOICE_PLAY_ALLOWED_HOSTS (comma list; default
//     storage.sautikit.com, the host SautiKit's upload API returns), and
//   - a ranged GET (bytes=0-0, 1.5 s timeout) answers 200/206 with an audio
//     or octet-stream type. GET, not HEAD: a presigned GET link refuses HEAD.
// The probe result is cached per URL (ok 10 min, failure 1 min), so most
// closed-line calls add no latency. Anything else falls back to <Say>.

const LINE_UNAVAILABLE_EN = 'Sorry, this line is not available right now. Goodbye.';
const LINE_UNAVAILABLE_SW = 'Samahani, laini hii haipatikani kwa sasa. Kwaheri.';

function digitsOf(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Kenyan numbers compare on their last nine digits (+254 / 254 / 0 forms). */
function sameNumber(a, b) {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9);
}

function rowArchived(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.archived === true) return true;
  return Boolean(row.archived_at);
}

function rowLive(row) {
  return Boolean(row) && row.is_active !== false && !rowArchived(row);
}

/**
 * Decide from the tenant rows that own the dialled number.
 * @param {Array<{ id: string, is_active?: boolean, archived_at?: string|null }>} rows
 * @returns {{ closed: boolean, reason: 'no_tenant'|'live'|'archived'|'inactive', tenantId: string|null }}
 */
function tenantLineState(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
  if (!list.length) return { closed: false, reason: 'no_tenant', tenantId: null };
  const live = list.find(rowLive);
  if (live) return { closed: false, reason: 'live', tenantId: live.id };
  const archived = list.find(rowArchived);
  const row = archived || list[0];
  return { closed: true, reason: archived ? 'archived' : 'inactive', tenantId: row.id };
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clipUrl(value) {
  const url = String(value || '').trim();
  return /^https:\/\/[^\s<>"]+$/i.test(url) ? url : '';
}

const DEFAULT_PLAY_HOSTS = ['storage.sautikit.com'];
const PROBE_TIMEOUT_MS = 1500;
const PROBE_OK_TTL_MS = 10 * 60 * 1000;
const PROBE_FAIL_TTL_MS = 60 * 1000;
const probeCache = new Map();

function allowedPlayHosts(env = process.env) {
  const raw = String(env.VOICE_PLAY_ALLOWED_HOSTS || '').trim();
  if (!raw) return DEFAULT_PLAY_HOSTS.slice();
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Host only, never the path or query (a presigned link carries a signature). */
function safeHost(url) {
  return hostOf(url) || 'invalid';
}

function hostAllowed(url, env = process.env) {
  const host = hostOf(url);
  return Boolean(host) && allowedPlayHosts(env).includes(host);
}

/**
 * Can the phone system fetch this clip right now? Ranged GET, short timeout.
 * @returns {Promise<{ ok: boolean, why: string }>}
 */
async function probeClip(url, { fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, why: 'no_fetch' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: ctrl.signal });
    try {
      if (res.body && typeof res.body.cancel === 'function') await res.body.cancel();
    } catch {
      /* ignore */
    }
    if (res.status !== 200 && res.status !== 206) return { ok: false, why: `status_${res.status}` };
    const type = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
    if (type && !/^(audio\/|application\/octet-stream|binary\/octet-stream)/.test(type)) return { ok: false, why: 'not_audio' };
    return { ok: true, why: 'ok' };
  } catch (err) {
    return { ok: false, why: ctrl.signal.aborted ? 'timeout' : 'fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The clip URL to <Play>, or '' to <Say>. Never throws.
 * @param {string} raw
 * @param {{ env?: object, fetchImpl?: Function, now?: () => number, timeoutMs?: number, log?: Function }} [opts]
 */
async function usableClipUrl(raw, { env = process.env, fetchImpl, now = Date.now, timeoutMs, log = console.warn } = {}) {
  const url = clipUrl(raw);
  if (!url) return '';
  if (!hostAllowed(url, env)) {
    log(`[line-unavailable] clip host ${safeHost(url)} not in VOICE_PLAY_ALLOWED_HOSTS — using <Say>`);
    return '';
  }
  const t = now();
  const hit = probeCache.get(url);
  if (hit && hit.until > t) return hit.ok ? url : '';
  let result;
  try {
    result = await probeClip(url, { fetchImpl, timeoutMs });
  } catch {
    result = { ok: false, why: 'probe_error' };
  }
  probeCache.set(url, { ok: result.ok, until: t + (result.ok ? PROBE_OK_TTL_MS : PROBE_FAIL_TTL_MS) });
  if (!result.ok) log(`[line-unavailable] clip on ${safeHost(url)} not fetchable (${result.why}) — using <Say>`);
  return result.ok ? url : '';
}

function resetClipProbeCache() {
  probeCache.clear();
}

/**
 * The XML for a closed line: the en then sw message, then hang up.
 * Sync and unchecked: pass already-checked clips (see lineUnavailableResponse).
 * @param {{ env?: object, clips?: { en?: string, sw?: string } }} [opts]
 */
function lineUnavailableXml({ env = process.env, clips } = {}) {
  const en = clipUrl(clips ? clips.en : env.VOICE_LINE_UNAVAILABLE_CLIP_URL_EN);
  const sw = clipUrl(clips ? clips.sw : env.VOICE_LINE_UNAVAILABLE_CLIP_URL_SW);
  const parts = [
    en ? `<Play>${escapeXml(en)}</Play>` : `<Say language="en-US">${escapeXml(LINE_UNAVAILABLE_EN)}</Say>`,
    sw ? `<Play>${escapeXml(sw)}</Play>` : `<Say language="sw-KE">${escapeXml(LINE_UNAVAILABLE_SW)}</Say>`,
    '<Hangup/>',
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join('')}</Response>`;
}

/**
 * The closed-line XML with each clip checked (allowed host + fetchable);
 * any clip that fails falls back to <Say> in its own language. Never throws.
 */
async function lineUnavailableResponse(opts = {}) {
  const env = opts.env || process.env;
  try {
    const [en, sw] = await Promise.all([
      usableClipUrl(env.VOICE_LINE_UNAVAILABLE_CLIP_URL_EN, { ...opts, env }),
      usableClipUrl(env.VOICE_LINE_UNAVAILABLE_CLIP_URL_SW, { ...opts, env }),
    ]);
    return lineUnavailableXml({ env, clips: { en, sw } });
  } catch {
    return lineUnavailableXml({ env, clips: { en: '', sw: '' } });
  }
}

module.exports = {
  LINE_UNAVAILABLE_EN,
  LINE_UNAVAILABLE_SW,
  sameNumber,
  tenantLineState,
  lineUnavailableXml,
  lineUnavailableResponse,
  usableClipUrl,
  probeClip,
  allowedPlayHosts,
  resetClipProbeCache,
};
