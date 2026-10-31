'use strict';

const crypto = require('crypto');
const { DEMO_TENANT_IDS, TOKEN_TTL_SEC } = require('./flags');

const ALLOWED_CLAIMS = ['tenant', 'lang', 'ip_hash', 'device_id', 'iat', 'exp', 'jti'];

function createTokenStore() {
  return new Map();
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Mint a 60s HS256 JWT for a demo tenant. No dial claim, no phone number.
 * `store` remembers the jti until verify consumes it.
 */
function mintDemoToken({ tenant, lang, ipHash, deviceId, secret, now = Date.now(), store }) {
  if (!secret) return { ok: false, reason: 'disabled' };
  if (!DEMO_TENANT_IDS.has(tenant)) return { ok: false, reason: 'tenant' };
  if (lang !== 'en' && lang !== 'sw') return { ok: false, reason: 'invalid' };
  if (!ipHash || !deviceId) return { ok: false, reason: 'invalid' };
  const iat = Math.floor(now / 1000);
  const exp = iat + TOKEN_TTL_SEC;
  const jti = crypto.randomUUID();
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({
    tenant,
    lang,
    ip_hash: ipHash,
    device_id: deviceId,
    iat,
    exp,
    jti,
  });
  const token = `${header}.${payload}.${sign(`${header}.${payload}`, secret)}`;
  if (store) {
    store.set(jti, { expMs: exp * 1000, used: false });
  }
  return { ok: true, token, jti, exp };
}

function verifyDemoToken(token, { secret, now = Date.now(), store } = {}) {
  if (!secret) return { ok: false, reason: 'disabled' };
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'rejected' };
  const [headerPart, payloadPart, signature] = parts;
  const header = decodePart(headerPart);
  const claims = decodePart(payloadPart);
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
    return { ok: false, reason: 'rejected' };
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    return { ok: false, reason: 'rejected' };
  }
  const keys = Object.keys(claims);
  if (keys.length !== ALLOWED_CLAIMS.length || ALLOWED_CLAIMS.some((key) => !keys.includes(key))) {
    return { ok: false, reason: 'rejected' };
  }
  const expected = sign(`${headerPart}.${payloadPart}`, secret);
  if (!safeEqual(expected, signature)) return { ok: false, reason: 'rejected' };
  if (!DEMO_TENANT_IDS.has(claims.tenant)) return { ok: false, reason: 'tenant' };
  if (claims.lang !== 'en' && claims.lang !== 'sw') return { ok: false, reason: 'rejected' };
  const expMs = Number(claims.exp) * 1000;
  if (!Number.isFinite(expMs) || now >= expMs) return { ok: false, reason: 'expired' };
  if (store) {
    const row = store.get(claims.jti);
    if (!row || row.used) return { ok: false, reason: 'reused' };
    if (now >= row.expMs) return { ok: false, reason: 'expired' };
    store.delete(claims.jti);
  }
  return { ok: true, claims };
}

module.exports = {
  ALLOWED_CLAIMS,
  createTokenStore,
  mintDemoToken,
  verifyDemoToken,
};
