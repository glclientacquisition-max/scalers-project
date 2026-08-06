// src/notifications/whatsapp.js
// Owner lead notifications via SautiKit WhatsApp Messaging API.

const SAUTIKIT_API_BASE = process.env.SAUTIKIT_API_BASE || 'https://api.sautikit.com';

function isWhatsAppConfigured() {
  return Boolean(
    process.env.SAUTIKIT_API_KEY &&
      (process.env.SAUTIKIT_WHATSAPP_NUMBER_ID || process.env.SAUTIKIT_WHATSAPP_CONNECTION_ID)
  );
}

/** Normalize to digits with country code, no leading +. */
function normalizeWhatsAppTo(phone) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  }
  return digits;
}

function buildLeadText({ businessName, name, reason, callerNumber, recordingUrl }) {
  const lines = [
    `New missed-call lead${businessName ? ` — ${businessName}` : ''}`,
    `Name: ${name || '—'}`,
    `Phone: ${callerNumber || '—'}`,
    `Reason: ${reason || '—'}`,
  ];
  if (recordingUrl) lines.push(`Recording: ${recordingUrl}`);
  return lines.join('\n');
}

/**
 * Send a WhatsApp message through SautiKit.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.body  free-form text (24h window) OR template body param fallback
 * @param {object} [opts.lead] structured fields for template components
 */
async function sendOwnerWhatsApp({ to, body, lead = {} }) {
  const apiKey = process.env.SAUTIKIT_API_KEY;
  if (!apiKey) throw new Error('SAUTIKIT_API_KEY is not configured');

  const numberId = process.env.SAUTIKIT_WHATSAPP_NUMBER_ID;
  const connectionId = process.env.SAUTIKIT_WHATSAPP_CONNECTION_ID;
  if (!numberId && !connectionId) {
    throw new Error('Set SAUTIKIT_WHATSAPP_NUMBER_ID or SAUTIKIT_WHATSAPP_CONNECTION_ID');
  }

  const toNorm = normalizeWhatsAppTo(to);
  if (!toNorm) throw new Error('WhatsApp destination number is empty');

  const templateName = process.env.SAUTIKIT_WHATSAPP_TEMPLATE;
  const templateLang = process.env.SAUTIKIT_WHATSAPP_TEMPLATE_LANG || 'en';

  /** @type {Record<string, unknown>} */
  let payload;
  if (templateName) {
    // Template params: {{1}} name, {{2}} phone, {{3}} reason — adjust in Meta to match.
    payload = {
      ...(numberId ? { number_id: numberId } : { connection_id: connectionId }),
      to: toNorm,
      type: 'template',
      template: {
        name: templateName,
        language_code: templateLang,
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: String(lead.name || 'Caller') },
              { type: 'text', text: String(lead.callerNumber || toNorm) },
              { type: 'text', text: String(lead.reason || 'Missed call') },
            ],
          },
        ],
      },
    };
  } else {
    payload = {
      ...(numberId ? { number_id: numberId } : { connection_id: connectionId }),
      to: toNorm,
      type: 'text',
      text: {
        body: body || buildLeadText(lead),
        preview_url: Boolean(lead.recordingUrl),
      },
    };
  }

  const res = await fetch(`${SAUTIKIT_API_BASE}/v1/whatsapp/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (res.status !== 202 && res.status !== 200) {
    const err = new Error(
      `SautiKit WhatsApp send failed: ${res.status} ${text.slice(0, 300)}`
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json;
}

module.exports = {
  isWhatsAppConfigured,
  normalizeWhatsAppTo,
  buildLeadText,
  sendOwnerWhatsApp,
};
