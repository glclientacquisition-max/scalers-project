// Owner/teammate SMS via TextSMS.co.ke (Kenya bulk SMS API).
// Private-beta primary notify while WhatsApp / email catch up.
// Docs: https://textsms.co.ke/bulk-sms-api/

const TEXTSMS_SEND_URL =
  process.env.TEXTSMS_API_URL || 'https://sms.textsms.co.ke/api/services/sendsms/';
const TEXTSMS_BALANCE_URL =
  process.env.TEXTSMS_BALANCE_URL ||
  'https://sms.textsms.co.ke/api/services/getbalance/';

/** @type {{ configured: boolean, verified: boolean|null, code: number|null, description: string|null, balance: number|null, checkedAt: string|null, shortcode: string|null }} */
let lastProbe = {
  configured: false,
  verified: null,
  code: null,
  description: null,
  balance: null,
  checkedAt: null,
  shortcode: null,
};

function isSmsConfigured() {
  return Boolean(
    process.env.TEXTSMS_API_KEY &&
      process.env.TEXTSMS_PARTNER_ID &&
      process.env.TEXTSMS_SHORTCODE
  );
}

/** Normalize to Kenya/international digits without leading +. */
function normalizeSmsTo(phone) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  // Local 07XXXXXXXX → 2547XXXXXXXX
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  }
  return digits;
}

function parseTextSmsCode(json) {
  const first =
    Array.isArray(json?.responses) && json.responses.length ? json.responses[0] : null;
  const raw =
    first?.['respose-code'] ??
    first?.['response-code'] ??
    json?.['response-code'] ??
    json?.responseCode ??
    first?.responseCode ??
    NaN;
  const code = Number(raw);
  const description = String(
    first?.['response-description'] ||
      json?.['response-description'] ||
      first?.responseDescription ||
      json?.responseDescription ||
      ''
  ).trim();
  return {
    code: Number.isFinite(code) ? code : null,
    description: description || null,
    first,
  };
}

/**
 * Cheap credential check against TextSMS getbalance (no SMS charged).
 * Caches the latest result for /healthz and boot logs.
 */
async function probeSmsCredentials({ force = false } = {}) {
  const configured = isSmsConfigured();
  const shortcode = process.env.TEXTSMS_SHORTCODE || null;
  if (!configured) {
    lastProbe = {
      configured: false,
      verified: false,
      code: null,
      description: 'missing_env',
      balance: null,
      checkedAt: new Date().toISOString(),
      shortcode,
    };
    return { ...lastProbe };
  }

  if (
    !force &&
    lastProbe.checkedAt &&
    lastProbe.configured &&
    Date.now() - Date.parse(lastProbe.checkedAt) < 60_000
  ) {
    return { ...lastProbe };
  }

  const apiKey = process.env.TEXTSMS_API_KEY;
  const partnerID = process.env.TEXTSMS_PARTNER_ID;
  try {
    const res = await fetch(TEXTSMS_BALANCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: apiKey,
        partnerID: String(partnerID),
      }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    const { code, description } = parseTextSmsCode(json);
    const balanceRaw =
      json?.credit ?? json?.balance ?? json?.['credit-balance'] ?? json?.Credit;
    const balance = Number(balanceRaw);
    const verified = res.ok && code === 200;
    lastProbe = {
      configured: true,
      verified,
      code,
      description: description || (verified ? 'ok' : 'probe_failed'),
      balance: Number.isFinite(balance) ? balance : null,
      checkedAt: new Date().toISOString(),
      shortcode,
    };
    return { ...lastProbe };
  } catch (err) {
    lastProbe = {
      configured: true,
      verified: false,
      code: null,
      description: String(err?.message || err).slice(0, 200),
      balance: null,
      checkedAt: new Date().toISOString(),
      shortcode,
    };
    return { ...lastProbe };
  }
}

function getSmsStatus() {
  return {
    ...lastProbe,
    configured: isSmsConfigured(),
    shortcode: process.env.TEXTSMS_SHORTCODE || lastProbe.shortcode,
    sendUrl: TEXTSMS_SEND_URL,
  };
}

/**
 * Send one SMS through TextSMS.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.body
 */
async function sendSms({ to, body } = {}) {
  const apiKey = process.env.TEXTSMS_API_KEY;
  const partnerID = process.env.TEXTSMS_PARTNER_ID;
  const shortcode = process.env.TEXTSMS_SHORTCODE;
  if (!apiKey || !partnerID || !shortcode) {
    throw new Error('TEXTSMS_API_KEY, TEXTSMS_PARTNER_ID, and TEXTSMS_SHORTCODE are required');
  }

  const mobile = normalizeSmsTo(to);
  if (!mobile || mobile.length < 9) {
    throw new Error('SMS destination number is empty or invalid');
  }

  const message = String(body || '').trim();
  if (!message) throw new Error('SMS message body is empty');

  const payload = {
    apikey: apiKey,
    partnerID: String(partnerID),
    message,
    shortcode: String(shortcode),
    mobile,
    pass_type: 'plain',
  };

  const res = await fetch(TEXTSMS_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  const { code, description, first } = parseTextSmsCode(json);

  if (!res.ok || (Number.isFinite(code) && code !== 200)) {
    // Keep health snapshot honest when sends fail auth.
    if (code === 1006) {
      lastProbe = {
        ...getSmsStatus(),
        configured: true,
        verified: false,
        code,
        description: description || 'Invalid credentials',
        checkedAt: new Date().toISOString(),
      };
    }
    const err = new Error(
      `TextSMS send failed: http=${res.status} code=${Number.isFinite(code) ? code : 'n/a'} ${description || text.slice(0, 200)}`
    );
    err.status = res.status;
    err.code = Number.isFinite(code) ? code : null;
    err.body = json;
    throw err;
  }

  lastProbe = {
    ...getSmsStatus(),
    configured: true,
    verified: true,
    code: 200,
    description: description || 'ok',
    checkedAt: new Date().toISOString(),
  };

  return {
    provider: 'textsms',
    mobile: first?.mobile || mobile,
    messageId: first?.messageid || first?.messageId || null,
    networkId: first?.networkid || first?.networkId || null,
    raw: json,
  };
}

module.exports = {
  isSmsConfigured,
  normalizeSmsTo,
  sendSms,
  probeSmsCredentials,
  getSmsStatus,
  TEXTSMS_SEND_URL,
  TEXTSMS_BALANCE_URL,
};
