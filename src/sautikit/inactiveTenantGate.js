'use strict';

// Inbound gate for a business that is archived or suspended.
//
// A tenant row with is_active = false, archived (archived_at set, Super
// Admin Archive, #636) or suspended (line_status = 'suspended') still owns
// its DID row until the number is released.
// resolveTenantId matched that DID by exact number and the call was answered:
// Stream opened, the model and speech ran, minutes were metered, and a
// dead tenant's setup could look like an outage. The call must not be taken.
//
// At POST /voice/incoming, before Stream and before the call row: if every
// tenant row that owns the dialled number is closed (isTenantLineInactive:
// archived, suspended or is_active = false), return a
// short "line unavailable" message and hang up. No /ws/media, no call row,
// no minutes, no outage alert. Any lookup error fails open (the gate never
// blocks a live business because the database blinked).
//
// The message: <Play> of the en and sw clips, else <Say> with the same
// approved copy. Generic copy: no business or agent name. The clips are
// src/speech/pcm/line-unavailable-{en,sw}.v1.wav, uploaded to SautiKit (the
// only supported way to give it audio) by lineUnavailableAudio.js; the signed
// storage.sautikit.com URLs and expiries are read from voice_platform_audio.
// downtime-* are the outage clips, never used here.
//
// Clip fallback. SautiKit reports no Play failure to us: a <Play> URL it
// cannot fetch (expired presigned link, 404) is just silence before
// <Hangup/>. So a clip is only used when
//   - a stored, unexpired https URL exists for that language,
//   - its host is storage.sautikit.com, and
//   - a ranged GET (bytes=0-0, 1.5 s timeout) answers 200/206 with an audio
//     or octet-stream type. GET, not HEAD: a presigned GET link refuses HEAD.
// The probe result is cached per URL (ok 10 min, failure 1 min), so most
// closed-line calls add no latency. Anything else falls back to <Say>.

// Later calls on a closed line (Completed / hangup / recording webhooks) are
// ignored via src/sautikit/closedLineCalls.js; with no call row they could
// not charge, alert or write a missed-call lead anyway.
//
// #645 (VOICE_FAST_INBOUND inbound directory, 30 s cache): this gate does not
// read that cache; it does one direct tenants read per inbound call, so an
// archive or suspension takes effect on the next call. If #645 wants to drop
// that read, its directory must select archived_at and line_status, decide
// with isTenantLineInactive(row) / tenantLineState(owners) from this file
// (live owner first), and keep the gate before Stream and the call row.

// Same words as the recorded clips (approved copy).
const LINE_UNAVAILABLE_EN = 'Hello. This line is not available right now. Thank you for calling.';
const LINE_UNAVAILABLE_SW = 'Habari. Nambari hii haipatikani kwa sasa. Asante kwa kupiga.';

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

/** line_status = 'suspended' (non-payment, docs/supabase/line_rental_grace.sql). 'grace' still answers. */
function rowSuspended(row) {
  if (!row || typeof row !== 'object') return false;
  return String(row.line_status || '').trim().toLowerCase() === 'suspended';
}

/**
 * Why this tenant's line must not take calls, or null when it is live.
 * Order: archived (Super Admin Archive, #636), suspended (line_status), then
 * is_active = false. A missing column is never a closure (older schemas).
 * @param {{ is_active?: boolean|null, archived_at?: string|null, archived?: boolean, line_status?: string|null }|null|undefined} tenant
 * @returns {'archived'|'suspended'|'inactive'|null}
 */
function tenantLineInactiveReason(tenant) {
  if (!tenant || typeof tenant !== 'object') return null;
  if (rowArchived(tenant)) return 'archived';
  if (rowSuspended(tenant)) return 'suspended';
  if (tenant.is_active === false) return 'inactive';
  return null;
}

/**
 * The single predicate for "this business's line is closed": archived_at set,
 * line_status = 'suspended', or is_active = false. Every inbound path that
 * picks a tenant for a number (db.inboundTenantLine, the #645 inbound
 * directory) must use this, so a new closed state plugs in here once.
 */
function isTenantLineInactive(tenant) {
  return tenantLineInactiveReason(tenant) !== null;
}

function rowLive(row) {
  return Boolean(row) && !isTenantLineInactive(row);
}

/**
 * Decide from the tenant rows that own the dialled number.
 * @param {Array<{ id: string, is_active?: boolean, archived_at?: string|null, line_status?: string|null }>} rows
 * @returns {{ closed: boolean, reason: 'no_tenant'|'live'|'archived'|'suspended'|'inactive', tenantId: string|null }}
 */
function tenantLineState(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
  if (!list.length) return { closed: false, reason: 'no_tenant', tenantId: null };
  const live = list.find(rowLive);
  if (live) return { closed: false, reason: 'live', tenantId: live.id };
  const rank = { archived: 0, suspended: 1, inactive: 2 };
  const row = list.slice().sort((a, b) => rank[tenantLineInactiveReason(a)] - rank[tenantLineInactiveReason(b)])[0];
  return { closed: true, reason: tenantLineInactiveReason(row), tenantId: row.id };
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

const { PLAY_HOST, storedClipUrls } = require('./lineUnavailableAudio');

const PROBE_TIMEOUT_MS = 1500;
const PROBE_OK_TTL_MS = 10 * 60 * 1000;
const PROBE_FAIL_TTL_MS = 60 * 1000;
const probeCache = new Map();

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

function hostAllowed(url) {
  return hostOf(url) === PLAY_HOST;
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
 * @param {{ fetchImpl?: Function, now?: () => number, timeoutMs?: number, log?: Function }} [opts]
 */
async function usableClipUrl(raw, { fetchImpl, now = Date.now, timeoutMs, log = console.warn } = {}) {
  const url = clipUrl(raw);
  if (!url) return '';
  if (!hostAllowed(url)) {
    log(`[line-unavailable] clip host ${safeHost(url)} is not ${PLAY_HOST} — using <Say>`);
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
 * @param {{ clips?: { en?: string, sw?: string } }} [opts]
 */
function lineUnavailableXml({ clips } = {}) {
  const en = clipUrl(clips && clips.en);
  const sw = clipUrl(clips && clips.sw);
  const parts = [
    en ? `<Play>${escapeXml(en)}</Play>` : `<Say language="en-US">${escapeXml(LINE_UNAVAILABLE_EN)}</Say>`,
    sw ? `<Play>${escapeXml(sw)}</Play>` : `<Say language="sw-KE">${escapeXml(LINE_UNAVAILABLE_SW)}</Say>`,
    '<Hangup/>',
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join('')}</Response>`;
}

/**
 * The closed-line XML with each stored clip checked (SautiKit host, unexpired,
 * fetchable); any clip that fails falls back to <Say> in its own language.
 * Never throws.
 * @param {{ loadClipUrls?: () => Promise<{ en?: string, sw?: string }>, fetchImpl?: Function, now?: () => number, timeoutMs?: number, log?: Function }} [opts]
 */
async function lineUnavailableResponse(opts = {}) {
  try {
    const load = opts.loadClipUrls || (() => storedClipUrls({ now: opts.now }));
    const stored = (await load()) || {};
    const [en, sw] = await Promise.all([usableClipUrl(stored.en, opts), usableClipUrl(stored.sw, opts)]);
    return lineUnavailableXml({ clips: { en, sw } });
  } catch {
    return lineUnavailableXml();
  }
}

module.exports = {
  LINE_UNAVAILABLE_EN,
  LINE_UNAVAILABLE_SW,
  sameNumber,
  isTenantLineInactive,
  tenantLineInactiveReason,
  tenantLineState,
  lineUnavailableXml,
  lineUnavailableResponse,
  usableClipUrl,
  probeClip,
  resetClipProbeCache,
};
