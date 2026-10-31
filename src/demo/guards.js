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
  visitorPersistOn,
  mentionsAris,
} = require('./flags');
const { createTokenStore, mintDemoToken, verifyDemoToken } = require('./token');
const {
  createMemoryVisitorStore,
  createSupabaseVisitorStore,
  createVisitorBook,
} = require('./visitors');

// Visitor use does not expire. One session at a time per hashed IP. The
// used marker is a salted hash of the IP and a salted hash of the device id.
// DEMO_VISITOR_PERSIST=on reloads demo_visitor_use. Otherwise the marker is
// in memory and a restart clears it. The raw IP is not stored. The spend
// cap is separate. There is no dial.

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const BUSY_MESSAGE = 'All demo lines are busy, try again in a minute.';
const PAUSED_MESSAGE = 'Demo paused.';
const STATUS_WINDOW_MS = 60 * 1000;
const STATUS_MAX = 30;

function hashValue(salt, value) {
  return crypto.createHash('sha256').update(`${salt}|${value}`).digest('hex');
}

function visitorHash(salt, kind, value) {
  return hashValue(salt, `${kind}|${value}`);
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
  const ipActive = new Map();
  const statusHits = new Map();
  let active = 0;
  const visitors = opts.visitors || createVisitorBook({
    envOf,
    now,
    log,
    store: visitorPersistOn(envOf())
      ? (opts.visitorStore || createSupabaseVisitorStore(opts.supabase))
      : createMemoryVisitorStore(),
  });

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

  async function limitReason(ipHash, deviceHash, env) {
    if (await visitors.blocked(ipHash, deviceHash)) return 'used';
    if ((ipActive.get(ipHash) || 0) >= 1) return 'rate';
    if (active >= maxConcurrent(env)) return 'busy';
    return null;
  }

  async function commitReservation({ ipHash, deviceHash, at, env }) {
    const reason = await limitReason(ipHash, deviceHash, env);
    if (reason) return { ok: false, reason };
    const claimed = await visitors.claim(ipHash, deviceHash, at);
    if (!claimed.ok) return claimed;
    ipActive.set(ipHash, (ipActive.get(ipHash) || 0) + 1);
    active += 1;
    return { ok: true, receipt: claimed.receipt };
  }

  async function rollbackReservation(ipHash, receipt) {
    active = Math.max(0, active - 1);
    const left = (ipActive.get(ipHash) || 1) - 1;
    if (left <= 0) ipActive.delete(ipHash);
    else ipActive.set(ipHash, left);
    try { await visitors.undo(receipt); } catch { /* the marker stays if undo fails */ }
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
    const salt = String(env.DEMO_IP_SALT);
    const ip = clientIp(req);
    const ipHash = visitorHash(salt, 'ip', ip);
    const deviceHash = visitorHash(salt, 'device', deviceId);
    if (!turnstile || turnstile.length > 2048) {
      writeLog('demo_token_reject', {
        reason: 'turnstile',
        origin: clip(origin),
        tenant,
        device_hash: deviceHash,
        ip_hash: ipHash,
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
    if (await overCap()) {
      writeLog('demo_token_reject', {
        reason: 'cap',
        origin: clip(origin),
        tenant,
        device_hash: deviceHash,
        ip_hash: ipHash,
      });
      return {
        status: 503,
        headers: corsHeaders(origin, env),
        body: { reason: 'cap' },
      };
    }
    const blocked = await limitReason(ipHash, deviceHash, env);
    if (blocked) {
      writeLog('demo_token_reject', {
        reason: blocked,
        origin: clip(origin),
        tenant,
        device_hash: deviceHash,
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
        device_hash: deviceHash,
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
        device_hash: deviceHash,
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
    const reserved = await commitReservation({ ipHash, deviceHash, at: again, env });
    if (!reserved.ok) {
      writeLog('demo_token_reject', {
        reason: reserved.reason,
        origin: clip(origin),
        tenant,
        device_hash: deviceHash,
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
      await rollbackReservation(ipHash, reserved.receipt);
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
    rememberReservation(minted.jti, { ipHash, deviceHash }, minted.exp);
    writeLog('demo_token_ok', {
      origin: clip(origin),
      tenant,
      lang,
      device_hash: deviceHash,
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

  async function statusView(ipHash, deviceHash) {
    const env = envOf();
    const enabled = demoEnabled(env);
    let cap = false;
    try {
      cap = Boolean(spend && typeof spend.blocked === 'function' && spend.blocked());
    } catch {
      cap = false;
    }
    const busy = active >= maxConcurrent(env);
    let used = false;
    try {
      used = await visitors.blocked(ipHash, deviceHash);
    } catch {
      used = false;
    }
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
    const salt = String(env.DEMO_IP_SALT || 'demo-status');
    const ipHash = visitorHash(salt, 'ip', clientIp(req));
    const deviceId = statusDeviceId(req);
    const deviceHash = deviceId ? visitorHash(salt, 'device', deviceId) : '';
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
      body: await statusView(ipHash, deviceHash),
    };
  }

  async function grant(req) {
    const env = envOf();
    const secret = String(env.VOICE_INTERNAL_SECRET || '').trim();
    const presented = header(req, 'x-voice-internal-secret').trim();
    if (!secret || presented !== secret) {
      writeLog('demo_grant_reject', { reason: 'unauthorized' });
      return {
        status: 401,
        headers: { 'cache-control': 'no-store' },
        body: { error: 'Unauthorized' },
      };
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const visitorHashValue = String(body.visitor_hash || '').trim().toLowerCase();
    const kind = String(body.kind || '').trim();
    const granted = await visitors.grant({
      visitorHash: visitorHashValue,
      kind,
      by: body.by,
      at: now(),
    });
    if (!granted.ok) {
      writeLog('demo_grant_reject', { reason: 'invalid' });
      return {
        status: 400,
        headers: { 'cache-control': 'no-store' },
        body: { reason: 'invalid' },
      };
    }
    writeLog('demo_grant', {
      visitor_hash: visitorHashValue,
      kind,
      grants_remaining: granted.grants_remaining,
    });
    return {
      status: 200,
      headers: { 'cache-control': 'no-store' },
      body: { ok: true, grants_remaining: granted.grants_remaining },
    };
  }

  return { decide, respond, verify, release, status, grant, store };
}

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function statusDeviceId(req) {
  const query = req.query && req.query.device_id;
  const raw = query != null ? String(query) : '';
  const value = raw.trim();
  if (!DEVICE_ID_RE.test(value)) return '';
  return value;
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

async function handleDemoGrantRequest(req, res) {
  let out;
  try {
    out = await getDemoGuard().grant(req);
  } catch {
    out = {
      status: 401,
      headers: { 'cache-control': 'no-store' },
      body: { error: 'Unauthorized' },
    };
  }
  if (res.headersSent) return out;
  for (const [key, value] of Object.entries(out.headers || {})) res.setHeader(key, value);
  res.status(out.status);
  if (out.body == null) res.end();
  else res.json(out.body);
  return out;
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
  handleDemoGrantRequest,
  hashValue,
  visitorHash,
  clientIp,
};
