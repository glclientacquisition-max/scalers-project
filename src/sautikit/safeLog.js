// Redact PII and secrets from voice HTTP / webhook / WS logs.
// Structured summaries replace raw header and body dumps (TD-P1-4).

const SENSITIVE_HEADER_RE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-sautikit-signature|x-api-key|x-voice-internal-secret)$/i;

const HEADER_ALLOW = new Set([
  'host',
  'content-type',
  'content-length',
  'user-agent',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-sautikit-event-kind',
  'x-sautikit-event-id',
  'x-request-id',
]);

const SENSITIVE_KEY_RE =
  /phone|msisdn|from|to|email|name|token|secret|password|auth|recording|caller|callee|number|address|cookie|signature/i;

const OPERATIONAL_KEYS = new Set([
  'callSid',
  'CallSid',
  'call_sid',
  'sessionId',
  'streamSid',
  'StreamSid',
  'callSessionState',
  'CallSessionState',
  'kind',
  'event',
  'event_type',
  'type',
  'duration',
  'Duration',
  'CallDuration',
  'durationSeconds',
]);

const MAX_STRING = 80;
const MAX_PREVIEW_CHARS = 400;
const DEFAULT_WS_SAMPLE_LIMIT = 3;

function headerName(key) {
  return String(key || '').toLowerCase();
}

function isSensitiveHeader(key) {
  return SENSITIVE_HEADER_RE.test(String(key || ''));
}

function sanitizeHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  for (const [key, value] of Object.entries(headers)) {
    out[key] = isSensitiveHeader(key) ? '[redacted]' : value;
  }
  return out;
}

function summarizeHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  for (const [key, value] of Object.entries(headers)) {
    const name = headerName(key);
    if (isSensitiveHeader(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (HEADER_ALLOW.has(name)) out[key] = value;
  }
  return out;
}

function isSensitiveKey(key) {
  const k = String(key || '');
  if (OPERATIONAL_KEYS.has(k)) return false;
  return SENSITIVE_KEY_RE.test(k);
}

function truncateString(value, max = MAX_STRING) {
  const text = String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function redactValue(key, value) {
  if (value == null) return value;
  if (isSensitiveKey(key)) return '[redacted]';
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

function collectKeys(value, prefix = '', into = []) {
  if (!value || typeof value !== 'object') return into;
  if (Array.isArray(value)) {
    value.slice(0, 8).forEach((item, i) => collectKeys(item, `${prefix}[${i}]`, into));
    return into;
  }
  for (const key of Object.keys(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    into.push(path);
    const child = value[key];
    if (child && typeof child === 'object') collectKeys(child, path, into);
  }
  return into;
}

function pickOperational(value, into = {}, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return into;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (OPERATIONAL_KEYS.has(key)) {
      const redacted = redactValue(key, child);
      if (redacted !== undefined) into[path] = redacted;
    }
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      pickOperational(child, into, path);
    }
  }
  return into;
}

function summarizeBody(body, { maxChars = MAX_PREVIEW_CHARS } = {}) {
  if (body == null) {
    return { keys: [], fields: {} };
  }
  if (typeof body !== 'object') {
    const text = truncateString(String(body), maxChars);
    return { keys: [], fields: { value: text } };
  }
  const keys = collectKeys(body).slice(0, 40);
  const fields = pickOperational(body);
  const preview = truncateString(JSON.stringify(fields), maxChars);
  return { keys, fields, previewChars: preview.length };
}

function summarizeWsPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { keys: [], event: null };
  }
  const keys = Object.keys(parsed).slice(0, 20);
  const meta = parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : parsed;
  const event = parsed.event || parsed.type || parsed.event_type || parsed.kind || null;
  const callSid =
    meta.callSid ||
    meta.sessionId ||
    meta.call_sid ||
    meta.call_id ||
    parsed.sessionId ||
    parsed.streamSid ||
    meta.streamSid ||
    null;
  return {
    event: event ? truncateString(String(event), 60) : null,
    keys,
    callSid: callSid ? truncateString(String(callSid), 80) : null,
  };
}

function createWsPayloadSampler(limit = DEFAULT_WS_SAMPLE_LIMIT) {
  let seen = 0;
  return function sampleWsPayload(parsed) {
    seen += 1;
    if (seen > limit) return null;
    return { sample: seen, limit, ...summarizeWsPayload(parsed) };
  };
}

module.exports = {
  SENSITIVE_HEADER_RE,
  HEADER_ALLOW,
  sanitizeHeaders,
  summarizeHeaders,
  summarizeBody,
  summarizeWsPayload,
  createWsPayloadSampler,
  isSensitiveHeader,
  isSensitiveKey,
};
