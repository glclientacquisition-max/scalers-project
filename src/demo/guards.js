'use strict';

const crypto = require('crypto');
const {
  TENANT_IDS,
  TOKEN_TTL_SEC,
  MAX_SEC,
  processDemoEnv,
  demoEnabled,
  originAllowed,
  maxConcurrent,
  sessionsPerVisitor,
  visitorWindowHours,
  mentionsAris,
} = require('./flags');
const { createTokenStore, mintDemoToken, verifyDemoToken } = require('./token');

// In-memory visit limits for one Voice instance. A second instance does not
// share that counter. Per hashed IP and per device id: DEMO_SESSIONS_PER_VISITOR
// (default 1) inside DEMO_VISITOR_WINDOW_HOURS (default 24). One session at a
// time per hashed IP. The maps store the hash and the device id, never the
// raw IP. The spend cap is separate and can reload from demo_spend when
// DEMO_SPEND_PERSIST is exactly on. There is no dial.

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const BUSY_MESSAGE = 'All demo lines are busy, try again in a minute.';
const PAUSED_MESSAGE = 'Demo paused.';
const STATUS_WINDOW_MS = 60 * 1000;
const STATUS_MAX = 30;

function hashValue(salt, value) {
  return crypto.createHash('sha256').update(`${salt}|${value}`).digest('hex');
}

function header(req, name) {
  const headers = req.headers || {};
  const direct = headers[name];
  if (direct != null) return Array.isArray(direct) ? String(direct[0]) : String(direct);
  return '';
}

function clientIp(req) {
  // Last hop is the address the nearest proxy added. The left side is client-supplied.
  const forwarded = header(req, 'x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  if (req.ip) return String(req.ip);
  return String(req.socket?.remoteAddress || '');
}

function corsHeaders(origin, env) {
  if (!originAllowed(origin, env)) return { 'cache-control': 'no-store' };
  return {
    'cache-control': 'no-store',
    'access-control-allow-origin': String(origin).trim(),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

function createDemoGuard(opts = {}) {
  const envOf = () => (opts.env ? opts.env : processDemoEnv());
  const now = () => (opts.now ? opts.now() : Date.now());
  const fetchImpl = opts.fetch || globalThis.fetch;
  const log = opts.log || ((line) => console.log(line));
  const store = opts.store || createTokenStore();
  const spend = opts.spend || null;
  const reservations = new Map();
  const ipHits = new Map();
  const deviceHits = new Map();
  const ipActive = new Map();
  const statusHits = new Map();
  let active = 0;

  async function overCap() {
    if (!spend || typeof spend.blocked !== 'function') return false;
    if (typeof spend.ready === 'function') {
      try { await spend.ready(); } catch { return false; }
    }
    try { return spend.blocked() === true; } catch { return false; }
  }

  function writeLog(kind, fields) {
    const safe = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value == null || value === '') continue;
      safe[key] = value;
    }
    log(`${kind} ${JSON.stringify(safe)}`);
  }

  function sweep(at) {
    for (const [jti, row] of reservations) {
      if (!row.used && row.expMs <= at) releaseReservation(jti);
    }
    for (const [jti, row] of store) {
      if (row.expMs <= at) store.delete(jti);
    }
    const span = windowMs(envOf());
    for (const map of [ipHits, deviceHits]) {
      for (const [key, list] of map) {
        const kept = freshHits(list, at, span);
        if (kept.length === 0) map.delete(key);
        else if (kept.length !== list.length) map.set(key, kept);
      }
    }
  }

  function releaseReservation(jti) {
    const row = reservations.get(jti);
    if (!row || row.released) return false;
    row.released = true;
    if (row.counted) {
      active = Math.max(0, active - 1);
      const left = (ipActive.get(row.ipHash) || 1) - 1;
      if (left <= 0) ipActive.delete(row.ipHash);
      else ipActive.set(row.ipHash, left);
      row.counted = false;
    }
    reservations.delete(jti);
    return true;
  }

  function readHits(map, key, at, span) {
    const kept = freshHits(map.get(key), at, span);
    if (kept.length === 0) map.delete(key);
    else map.set(key, kept);
    return kept;
  }

  function bumpHit(map, key, at, span) {
    const kept = readHits(map, key, at, span);
    kept.push(at);
    map.set(key, kept);
  }

  function unbumpHit(map, key) {
    const list = map.get(key);
    if (!list || list.length < 1) return;
    list.pop();
    if (list.length === 0) map.delete(key);
  }

  function limitReason(ipHash, deviceId, at, env) {
    const span = windowMs(env);
    const limit = sessionsPerVisitor(env);
    if (readHits(ipHits, ipHash, at, span).length >= limit) return 'used';
    if (deviceId && readHits(deviceHits, deviceId, at, span).length >= limit) return 'used';
    if ((ipActive.get(ipHash) || 0) >= 1) return 'rate';
    if (active >= maxConcurrent(env)) return 'busy';
    return null;
  }

  function commitReservation({ ipHash, deviceId, at, env }) {
    const reason = limitReason(ipHash, deviceId, at, env);
    if (reason) return { ok: false, reason };
    const span = windowMs(env);
    bumpHit(ipHits, ipHash, at, span);
    bumpHit(deviceHits, deviceId, at, span);
    ipActive.set(ipHash, (ipActive.get(ipHash) || 0) + 1);
    active += 1;
    return { ok: true };
  }

  function rememberReservation(jti, fields, expSec) {
    reservations.set(jti, {
      ...fields,
      expMs: expSec * 1000,
      used: false,
      counted: true,
      released: false,
    });
  }

  async function verifyTurnstile(token, ip, env) {
    const secret = String(env.TURNSTILE_SECRET_KEY || '');
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    let response;
    try {
      response = await fetchImpl(TURNSTILE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      return false;
    }
    let json;
    try {
      json = await response.json();
    } catch {
      return false;
    }
    return json?.success === true;
  }

  function paused(origin, env) {
    writeLog('demo_token_reject', { reason: 'disabled', origin: clip(origin) });
    return {
      status: 503,
      headers: corsHeaders(origin, env),
      body: { reason: 'disabled', message: PAUSED_MESSAGE },
    };
  }

  async function decide(req) {
    const env = envOf();
    const origin = header(req, 'origin').trim();
    const method = String(req.method || 'POST').toUpperCase();
    if (!demoEnabled(env)) return paused(origin, env);
    if (!originAllowed(origin, env)) {
      writeLog('demo_token_reject', { reason: 'origin', origin: clip(origin) });
      return {
        status: 403,
        headers: { 'cache-control': 'no-store' },
        body: { reason: 'origin' },
      };
    }
    if (method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders(origin, env), body: null };
    }
    const configGap = missingConfig(env);
    if (configGap) {
      writeLog('demo_token_reject', { reason: 'disabled', config: configGap, origin: clip(origin) });
      return {
        status: 503,
        headers: corsHeaders(origin, env),
        body: { reason: 'disabled', message: PAUSED_MESSAGE },
      };
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const tenantKey = String(body.tenant || '').trim();
    const lang = String(body.lang || '').trim();
    const deviceId = String(body.device_id || '').trim();
    const turnstile = String(body.turnstile || '').trim();
    const noticeV = String(body.notice_v || '').trim();
    const consent = body.consent_ts;
    if (
      mentionsAris(tenantKey) ||
      mentionsAris(deviceId) ||
      mentionsAris(lang) ||
      mentionsAris(noticeV)
    ) {
      writeLog('demo_token_reject', { reason: 'tenant', origin: clip(origin) });
      return {
        status: 403,
        headers: corsHeaders(origin, env),
        body: { reason: 'tenant' },
      };
    }
    const tenant = TENANT_IDS[tenantKey];
    if (!tenant) {
      writeLog('demo_token_reject', { reason: 'tenant', origin: clip(origin) });
      return {
        status: 403,
        headers: corsHeaders(origin, env),
        body: { reason: 'tenant' },
      };
    }
    if (lang !== 'en' && lang !== 'sw') {
      return invalid(origin, env);
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(deviceId)) return invalid(origin, env);
    if (!noticeV || noticeV.length > 32) return invalid(origin, env);
    if (!consentPresent(consent)) return invalid(origin, env);
    if (!turnstile || turnstile.length > 2048) {
      writeLog('demo_token_reject', {
        reason: 'turnstile',
        origin: clip(origin),
        tenant,
        device_hash: hashValue(String(env.DEMO_IP_SALT || ''), deviceId),
        turnstile: 'missing',
      });
      return {
        status: 403,
        headers: corsHeaders(origin, env),
        body: { reason: 'turnstile' },
      };
    }

    const at = now();
    sweep(at);
    const ip = clientIp(req);
    const salt = String(env.DEMO_IP_SALT);
    const ipHash = hashValue(salt, ip);
    if (await overCap()) {
      writeLog('demo_token_reject', {
        reason: 'cap',
        origin: clip(origin),
        tenant,
        device_hash: hashValue(salt, deviceId),
        ip_hash: ipHash,
      });
      return {
        status: 503,
        headers: corsHeaders(origin, env),
        body: { reason: 'cap' },
      };
    }
    const blocked = limitReason(ipHash, deviceId, at, env);
    if (blocked) {
      writeLog('demo_token_reject', {
        reason: blocked,
        origin: clip(origin),
        tenant,
        device_hash: hashValue(String(env.DEMO_IP_SALT || ''), deviceId),
        ip_hash: ipHash,
      });
      if (blocked === 'busy') {
        return {
          status: 503,
          headers: corsHeaders(origin, env),
          body: { reason: 'busy', message: BUSY_MESSAGE },
        };
      }
      return {
        status: 429,
        headers: corsHeaders(origin, env),
        body: { reason: blocked },
      };
    }

    const passed = await verifyTurnstile(turnstile, ip, env);
    if (!passed) {
      writeLog('demo_token_reject', {
        reason: 'turnstile',
        origin: clip(origin),
        tenant,
        device_hash: hashValue(String(env.DEMO_IP_SALT || ''), deviceId),
        ip_hash: ipHash,
        turnstile: 'fail',
      });
      return {
        status: 403,
        headers: corsHeaders(origin, env),
        body: { reason: 'turnstile' },
      };
    }

    if (await overCap()) {
      writeLog('demo_token_reject', {
        reason: 'cap',
        origin: clip(origin),
        tenant,
        device_hash: hashValue(salt, deviceId),
        ip_hash: ipHash,
      });
      return {
        status: 503,
        headers: corsHeaders(origin, env),
        body: { reason: 'cap' },
      };
    }

    const again = now();
    sweep(again);
    const reserved = commitReservation({ ipHash, deviceId, at: again, env });
    if (!reserved.ok) {
      writeLog('demo_token_reject', {
        reason: reserved.reason,
        origin: clip(origin),
        tenant,
        device_hash: hashValue(String(env.DEMO_IP_SALT || ''), deviceId),
        ip_hash: ipHash,
      });
      if (reserved.reason === 'busy') {
        return {
          status: 503,
          headers: corsHeaders(origin, env),
          body: { reason: 'busy', message: BUSY_MESSAGE },
        };
      }
      return {
        status: 429,
        headers: corsHeaders(origin, env),
        body: { reason: reserved.reason },
      };
    }

    const minted = mintDemoToken({
      tenant,
      lang,
      ipHash,
      deviceId,
      secret: String(env.DEMO_TOKEN_SECRET),
      now: again,
      store,
    });
    if (!minted.ok) {
      active = Math.max(0, active - 1);
      const left = (ipActive.get(ipHash) || 1) - 1;
      if (left <= 0) ipActive.delete(ipHash);
      else ipActive.set(ipHash, left);
      unbumpHit(ipHits, ipHash);
      unbumpHit(deviceHits, deviceId);
      writeLog('demo_token_reject', { reason: minted.reason, origin: clip(origin), tenant });
      const status = minted.reason === 'tenant' ? 403 : 503;
      return {
        status,
        headers: corsHeaders(origin, env),
        body: minted.reason === 'disabled'
          ? { reason: 'disabled', message: PAUSED_MESSAGE }
          : { reason: minted.reason },
      };
    }
    rememberReservation(minted.jti, { ipHash, deviceId }, minted.exp);
    writeLog('demo_token_ok', {
      origin: clip(origin),
      tenant,
      lang,
      device_hash: hashValue(salt, deviceId),
      ip_hash: ipHash,
      turnstile: 'pass',
      consent_ts: consent,
      notice_v: noticeV,
    });
    return {
      status: 200,
      headers: corsHeaders(origin, env),
      body: {
        token: minted.token,
        ws_url: wsUrl(req, minted.token, env),
        max_sec: MAX_SEC,
      },
    };
  }

  function invalid(origin, env) {
    writeLog('demo_token_reject', { reason: 'invalid', origin: clip(origin) });
    return {
      status: 400,
      headers: corsHeaders(origin, env),
      body: { reason: 'invalid' },
    };
  }

  function verify(token) {
    const at = now();
    sweep(at);
    const result = verifyDemoToken(token, {
      secret: String(envOf().DEMO_TOKEN_SECRET || ''),
      now: at,
      store,
    });
    if (result.ok) {
      const row = reservations.get(result.claims.jti);
      if (row) row.used = true;
    }
    return result;
  }

  function release(jti) {
    sweep(now());
    return releaseReservation(jti);
  }

  async function respond(req, res) {
    let out;
    try {
      out = await decide(req);
    } catch {
      out = {
        status: 503,
        headers: { 'cache-control': 'no-store' },
        body: { reason: 'disabled', message: PAUSED_MESSAGE },
      };
      writeLog('demo_token_reject', { reason: 'disabled' });
    }
    if (res.headersSent) return out;
    for (const [key, value] of Object.entries(out.headers || {})) res.setHeader(key, value);
    res.status(out.status);
    if (out.body == null) res.end();
    else res.json(out.body);
    return out;
  }

  function allowStatus(ipHash, at) {
    const prev = statusHits.get(ipHash) || [];
    const kept = [];
    for (const ts of prev) {
      if (at - ts < STATUS_WINDOW_MS) kept.push(ts);
    }
    if (kept.length >= STATUS_MAX) {
      statusHits.set(ipHash, kept);
      return false;
    }
    kept.push(at);
    statusHits.set(ipHash, kept);
    return true;
  }

  function statusView(at, ipHash) {
    const env = envOf();
    const enabled = demoEnabled(env);
    let cap = false;
    try {
      cap = Boolean(spend && typeof spend.blocked === 'function' && spend.blocked());
    } catch {
      cap = false;
    }
    const busy = active >= maxConcurrent(env);
    const used = Boolean(ipHash) && readHits(ipHits, ipHash, at, windowMs(env)).length >= sessionsPerVisitor(env);
    let reason = null;
    if (!enabled) reason = 'disabled';
    else if (cap) reason = 'cap';
    else if (used) reason = 'used';
    else if (busy) reason = 'busy';
    return { enabled, busy, cap, reason };
  }

  async function status(req) {
    const env = envOf();
    const origin = header(req, 'origin').trim();
    const at = now();
    const ipHash = hashValue(String(env.DEMO_IP_SALT || 'demo-status'), clientIp(req));
    if (!allowStatus(ipHash, at)) {
      writeLog('demo_status_reject', { reason: 'rate', ip_hash: ipHash });
      return {
        status: 429,
        headers: { 'cache-control': 'no-store' },
        body: { reason: 'rate' },
      };
    }
    if (!originAllowed(origin, env)) {
      writeLog('demo_status_reject', { reason: 'origin', ip_hash: ipHash });
      return {
        status: 403,
        headers: { 'cache-control': 'no-store' },
        body: { reason: 'origin' },
      };
    }
    if (spend && typeof spend.ready === 'function') {
      try { await spend.ready(); } catch { /* in-memory cap still applies */ }
    }
    return {
      status: 200,
      headers: corsHeaders(origin, env),
      body: statusView(at, ipHash),
    };
  }

  return { decide, respond, verify, release, status, store };
}

function windowMs(env) {
  return visitorWindowHours(env) * 60 * 60 * 1000;
}

function freshHits(list, at, span) {
  if (!list || list.length === 0) return [];
  const kept = [];
  for (const ts of list) {
    if (at - ts < span) kept.push(ts);
  }
  return kept;
}

function missingConfig(env) {
  if (!String(env.DEMO_TOKEN_SECRET || '').trim()) return 'token';
  if (!String(env.DEMO_IP_SALT || '').trim()) return 'salt';
  if (!String(env.TURNSTILE_SECRET_KEY || '').trim()) return 'turnstile';
  return null;
}

function consentPresent(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim()) return Number.isFinite(Date.parse(value));
  return false;
}

function clip(origin) {
  const value = String(origin || '');
  return value.length > 200 ? value.slice(0, 200) : value;
}

function wsUrl(req, token, env) {
  const encoded = encodeURIComponent(token);
  const base = String(env.DEMO_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || '').trim();
  if (base) {
    const url = new URL(base);
    const scheme = url.protocol === 'http:' ? 'ws:' : 'wss:';
    return `${scheme}//${url.host}/ws/demo?t=${encoded}`;
  }
  const host = header(req, 'x-forwarded-host') || header(req, 'host') || 'localhost';
  const proto = (header(req, 'x-forwarded-proto') || 'https').split(',')[0].trim();
  const scheme = proto === 'http' ? 'ws' : 'wss';
  return `${scheme}://${host}/ws/demo?t=${encoded}`;
}

let singleton = null;

function getDemoGuard() {
  if (!singleton) {
    let spend = null;
    try { spend = require('./meter').getDemoLedger(); } catch { spend = null; }
    singleton = createDemoGuard({ spend });
  }
  return singleton;
}

function handleDemoTokenRequest(req, res) {
  return getDemoGuard().respond(req, res);
}

async function handleDemoStatusRequest(req, res) {
  let out;
  try {
    out = await getDemoGuard().status(req);
  } catch {
    out = {
      status: 503,
      headers: { 'cache-control': 'no-store' },
      body: { enabled: false, busy: false, cap: false, reason: 'disabled' },
    };
  }
  if (res.headersSent) return out;
  for (const [key, value] of Object.entries(out.headers || {})) res.setHeader(key, value);
  res.status(out.status);
  if (out.body == null) res.end();
  else res.json(out.body);
  return out;
}

module.exports = {
  TURNSTILE_URL,
  BUSY_MESSAGE,
  PAUSED_MESSAGE,
  TOKEN_TTL_SEC,
  STATUS_MAX,
  STATUS_WINDOW_MS,
  createDemoGuard,
  getDemoGuard,
  handleDemoTokenRequest,
  handleDemoStatusRequest,
  hashValue,
  clientIp,
};
