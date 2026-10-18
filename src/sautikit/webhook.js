// src/sautikit/webhook.js
// Verify SautiKit HMAC webhook signatures (X-Sautikit-Signature).

const crypto = require('crypto');

/**
 * Parse `t=<unix>,v1=<hex>` signature header.
 * @param {string} header
 * @returns {{ t: string, v1: string } | null}
 */
function parseSignatureHeader(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = Object.create(null);
  for (const piece of header.split(',')) {
    const [k, v] = piece.trim().split('=');
    if (k && v) parts[k] = v;
  }
  if (!parts.t || !parts.v1) return null;
  return { t: parts.t, v1: parts.v1 };
}

/**
 * @param {object} opts
 * @param {string} opts.secret
 * @param {string|Buffer} opts.rawBody
 * @param {string} [opts.signatureHeader]
 * @param {number} [opts.maxSkewSeconds]
 * @returns {boolean}
 */
function verifySautikitSignature({
  secret,
  rawBody,
  signatureHeader,
  maxSkewSeconds = 300,
}) {
  if (!secret) return true; // verification disabled when secret unset
  return checkSignature({ secrets: [{ name: 'secret', value: secret }], rawBody, signatureHeader, maxSkewSeconds }).ok;
}

/**
 * HMAC-SHA256(secret, rawBytes + "." + t), hex. Hashes the raw bytes as
 * received (no utf8 round trip).
 */
function signatureFor(secret, rawBody, t) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  return crypto.createHmac('sha256', secret).update(buf).update('.').update(String(t)).digest('hex');
}

function safeEqualHex(expected, given) {
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(String(given), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verify against every configured secret.
 * @returns {{ ok: boolean, reason: string, matched: string }}
 *   reason: ok | missing | malformed | stale | mismatch | no_raw_body | no_secret
 *   matched: the env name of the secret that matched (never its value), or 'none'
 */
function checkSignature({ secrets, rawBody, signatureHeader, maxSkewSeconds = 300, nowSeconds }) {
  const list = (secrets || []).filter((s) => s && s.value);
  if (!list.length) return { ok: false, reason: 'no_secret', matched: 'none' };
  if (!signatureHeader) return { ok: false, reason: 'missing', matched: 'none' };
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed', matched: 'none' };
  const ts = Number(parsed.t);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'malformed', matched: 'none' };
  const now = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxSkewSeconds) return { ok: false, reason: 'stale', matched: 'none' };
  if (rawBody == null) return { ok: false, reason: 'no_raw_body', matched: 'none' };
  for (const s of list) {
    if (safeEqualHex(signatureFor(s.value, rawBody, parsed.t), parsed.v1)) {
      return { ok: true, reason: 'ok', matched: s.name };
    }
  }
  return { ok: false, reason: 'mismatch', matched: 'none' };
}

/** Configured secrets by env name. Values never leave this module except into the HMAC. */
function configuredSecrets() {
  return [
    { name: 'SAUTIKIT_VOICE_SIGNING_SECRET', value: process.env.SAUTIKIT_VOICE_SIGNING_SECRET || '' },
    { name: 'SAUTIKIT_WEBHOOK_SECRET', value: process.env.SAUTIKIT_WEBHOOK_SECRET || '' },
  ].filter((s) => s.value);
}

/** off (unset / anything else) | shadow | true */
function validationMode(env) {
  const raw = env ? env.SAUTIKIT_VALIDATE_WEBHOOKS : process.env.SAUTIKIT_VALIDATE_WEBHOOKS;
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'true') return 'true';
  if (v === 'shadow') return 'shadow';
  return 'off';
}

function cleanForLog(value, max = 80) {
  return String(value || '-').replace(/[\s\r\n]+/g, '_').slice(0, max);
}

let warnedNoSecret = 0;

/**
 * Express middleware. Needs req.rawBody (server.js captures it for every
 * content type).
 *
 * SAUTIKIT_VALIDATE_WEBHOOKS:
 *   unset/other: pass through (no logging).
 *   shadow: verify, log one line, always pass.
 *   true:   verify; 401 on a bad signature. No secret set: log loudly and
 *           fail open (a missed env step must not drop every call).
 * Secrets: SAUTIKIT_VOICE_SIGNING_SECRET and/or SAUTIKIT_WEBHOOK_SECRET; a
 * signature matching either passes. Logs name the env var, never the value.
 */
function sautikitWebhookGuard(req, res, next) {
  const mode = validationMode();
  if (mode === 'off') return next();

  const secrets = configuredSecrets();
  const route = cleanForLog(req.path || req.originalUrl || req.url);
  const ua = cleanForLog(req.headers['user-agent']);

  if (!secrets.length) {
    if (mode === 'true') {
      warnedNoSecret += 1;
      if (warnedNoSecret === 1 || warnedNoSecret % 100 === 0) {
        console.error(
          `[sautikit] SAUTIKIT_VALIDATE_WEBHOOKS=true but no SAUTIKIT_VOICE_SIGNING_SECRET or SAUTIKIT_WEBHOOK_SECRET set — NOT VERIFYING, passing request through (count=${warnedNoSecret})`
        );
      }
    }
    console.log(`[sautikit] sig route=${route} ok=false reason=no_secret matched=none ua=${ua} mode=${mode}`);
    return next();
  }

  const header = req.headers['x-sautikit-signature'];
  const result = checkSignature({
    secrets,
    rawBody: req.rawBody != null ? req.rawBody : null,
    signatureHeader: header,
  });
  console.log(
    `[sautikit] sig route=${route} ok=${result.ok} reason=${result.reason} matched=${result.matched} ua=${ua} mode=${mode}`
  );
  if (mode === 'shadow' || result.ok) return next();
  console.warn('[sautikit] webhook signature verification failed');
  return res.status(401).json({ error: 'invalid_signature' });
}

/** Exact paths that sit behind sautikitWebhookGuard in server.js. */
const SAUTIKIT_WEBHOOK_PATHS = new Set([
  '/',
  '/voice',
  '/voice/incoming',
  '/voice/events',
  '/voice/transfer',
  '/voice/recording-status',
  '/whatsapp/events',
]);

/**
 * App-wide body parsers. JSON (1mb) and urlencoded keep their raw bytes on
 * req.rawBody. On the SautiKit webhook paths any other content type is read
 * raw too, so the guard always hashes the bytes that were sent; req.body is
 * then reset to {} so handlers see what express gave them before.
 */
function installWebhookBodyParsers(app, express) {
  const captureRawBody = (req, _res, buf) => {
    req.rawBody = buf;
  };
  app.use(express.json({ limit: '1mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, verify: captureRawBody }));
  app.use(
    express.raw({
      type: (req) => SAUTIKIT_WEBHOOK_PATHS.has(req.path),
      limit: '1mb',
      verify: captureRawBody,
    })
  );
  app.use((req, _res, next) => {
    if (Buffer.isBuffer(req.body)) req.body = {};
    next();
  });
}

module.exports = {
  SAUTIKIT_WEBHOOK_PATHS,
  installWebhookBodyParsers,
  parseSignatureHeader,
  verifySautikitSignature,
  checkSignature,
  signatureFor,
  configuredSecrets,
  validationMode,
  sautikitWebhookGuard,
};
