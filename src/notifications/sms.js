// Owner/teammate SMS via TextSMS.co.ke (Kenya bulk SMS API).
// Private-beta primary notify while WhatsApp / email catch up.
// Docs: https://textsms.co.ke/bulk-sms-api/

const TEXTSMS_SEND_URL =
  process.env.TEXTSMS_API_URL || 'https://sms.textsms.co.ke/api/services/sendsms/';

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

  const first =
    Array.isArray(json?.responses) && json.responses.length ? json.responses[0] : null;
  // TextSMS docs use the typo "respose-code".
  const code = Number(
    first?.['respose-code'] ?? first?.['response-code'] ?? first?.responseCode ?? NaN
  );
  const description = String(
    first?.['response-description'] || first?.responseDescription || ''
  ).trim();

  if (!res.ok || (Number.isFinite(code) && code !== 200)) {
    const err = new Error(
      `TextSMS send failed: http=${res.status} code=${Number.isFinite(code) ? code : 'n/a'} ${description || text.slice(0, 200)}`
    );
    err.status = res.status;
    err.code = Number.isFinite(code) ? code : null;
    err.body = json;
    throw err;
  }

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
  TEXTSMS_SEND_URL,
};
