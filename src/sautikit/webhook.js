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
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const ts = Number(parsed.t);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > maxSkewSeconds) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const payload = `${body}.${parsed.t}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parsed.v1, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Express middleware — requires `express.raw` or captured raw body on req.rawBody.
 * When SAUTIKIT_VALIDATE_WEBHOOKS is not true, passes through.
 */
function sautikitWebhookGuard(req, res, next) {
  const validate =
    String(process.env.SAUTIKIT_VALIDATE_WEBHOOKS || '').toLowerCase() === 'true';
  if (!validate) return next();

  const secret =
    process.env.SAUTIKIT_WEBHOOK_SECRET || process.env.SAUTIKIT_VOICE_SIGNING_SECRET;
  if (!secret) {
    console.warn('[sautikit] SAUTIKIT_VALIDATE_WEBHOOKS=true but no webhook secret set');
    return res.status(500).json({ error: 'webhook_secret_not_configured' });
  }

  const rawBody = req.rawBody != null ? req.rawBody : JSON.stringify(req.body || {});
  const header = req.headers['x-sautikit-signature'] || req.headers['X-Sautikit-Signature'];
  const ok = verifySautikitSignature({
    secret,
    rawBody,
    signatureHeader: header,
  });
  if (!ok) {
    console.warn('[sautikit] webhook signature verification failed');
    return res.status(401).json({ error: 'invalid_signature' });
  }
  return next();
}

module.exports = {
  parseSignatureHeader,
  verifySautikitSignature,
  sautikitWebhookGuard,
};
