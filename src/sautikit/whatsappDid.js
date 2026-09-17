// Probe SautiKit WhatsApp Calling on a DID (read-only).
// GET /v1/numbers + GET /v1/numbers/{id}/whatsapp
// Docs: https://sautikit.com/developers/api (WhatsApp Calling)

const SAUTIKIT_API_BASE = process.env.SAUTIKIT_API_BASE || 'https://api.sautikit.com';

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Local 07XXXXXXXX or E.164 → +2547XXXXXXXX */
function normalizeKenyaDid(input) {
  let digits = digitsOnly(input);
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  }
  if (digits.startsWith('254') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    return `+254${digits}`;
  }
  return digits ? `+${digits}` : '';
}

function listFromPayload(json) {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.numbers)) return json.numbers;
  if (Array.isArray(json)) return json;
  return [];
}

function matchNumber(numbers, did) {
  const want = digitsOnly(normalizeKenyaDid(did));
  return (numbers || []).find((n) => digitsOnly(n?.e164 || n?.number || '').endsWith(want.slice(-9)));
}

function publicTrunk(json) {
  if (!json || typeof json !== 'object') return null;
  return {
    status: json.status || null,
    provisioning_step: json.provisioning_step || null,
    external_id: json.external_id || null,
    last_error: json.last_error || null,
    readiness: json.readiness || null,
    provider: json.provider || null,
    provider_config: json.provider_config || null,
  };
}

function isTrunkActive(trunk) {
  if (!trunk) return false;
  const status = String(trunk.status || '').toLowerCase();
  if (status === 'active') return true;
  const ready = trunk.readiness;
  if (ready && typeof ready === 'object') {
    if (ready.status === 'AVAILABLE' || ready.available === true) return true;
  }
  return false;
}

async function sautikitFetch(path, { apiKey } = {}) {
  const key = apiKey || process.env.SAUTIKIT_API_KEY;
  if (!key) {
    const err = new Error('SAUTIKIT_API_KEY is not configured');
    err.code = 'not_configured';
    throw err;
  }
  const res = await fetch(`${SAUTIKIT_API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

/**
 * Read-only WhatsApp Calling smoke for one DID.
 * @param {object} [opts]
 * @param {string} [opts.did]
 * @param {string} [opts.apiKey]
 */
async function probeWhatsAppDid(opts = {}) {
  const did = opts.did || process.env.SAUTIKIT_DID || '0709221536';
  const e164 = normalizeKenyaDid(did);
  const apiKey = opts.apiKey;

  const list = await sautikitFetch('/v1/numbers', { apiKey });
  if (list.status < 200 || list.status >= 300) {
    return {
      ok: false,
      active: false,
      e164,
      error: 'numbers_list_failed',
      listStatus: list.status,
      listError: list.json?.error || list.json,
    };
  }

  const numbers = listFromPayload(list.json);
  const number = matchNumber(numbers, e164);
  if (!number) {
    return {
      ok: false,
      active: false,
      e164,
      error: 'did_not_in_workspace',
      listStatus: list.status,
      workspaceE164: numbers.map((n) => n.e164).filter(Boolean),
    };
  }

  const [trunkRes, settingsRes] = await Promise.all([
    sautikitFetch(`/v1/numbers/${number.id}/whatsapp`, { apiKey }),
    sautikitFetch(`/v1/numbers/${number.id}/whatsapp/call-settings`, { apiKey }),
  ]);

  const trunk = trunkRes.status === 200 ? publicTrunk(trunkRes.json) : null;
  const active = trunkRes.status === 200 && isTrunkActive(trunk);

  return {
    ok: trunkRes.status === 200 || trunkRes.status === 404,
    active,
    e164,
    number: {
      id: number.id,
      e164: number.e164,
      status: number.status,
      capabilities: number.capabilities || null,
    },
    trunkHttpStatus: trunkRes.status,
    trunk,
    trunkError: trunkRes.status === 200 ? null : trunkRes.json?.error || trunkRes.json,
    callSettingsHttpStatus: settingsRes.status,
    callSettings: settingsRes.status === 200 ? settingsRes.json : null,
  };
}

module.exports = {
  normalizeKenyaDid,
  listFromPayload,
  matchNumber,
  isTrunkActive,
  publicTrunk,
  probeWhatsAppDid,
};
