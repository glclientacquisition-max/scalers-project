// src/notifications/whatsapp.js
// Owner / platform WhatsApp via SautiKit Messaging API.
// Phase 0 dual-use: sender is always the Scalers platform number
// (SautiKit 81424fbd-8f4c-459a-858d-98ced4393df6 / +254709221536).
// Voice on that DID still belongs to Done and Dusted until Phase 2.
// Do not send shop-caller chat from this number. Do not enable Calling.

const SAUTIKIT_API_BASE = process.env.SAUTIKIT_API_BASE || 'https://api.sautikit.com';
const { isWhatsAppSessionOpen } = require('../sautikit/whatsappInbound');

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

function platformWhatsAppSender() {
  const numberId = String(process.env.SAUTIKIT_WHATSAPP_NUMBER_ID || '').trim();
  const connectionId = String(process.env.SAUTIKIT_WHATSAPP_CONNECTION_ID || '').trim();
  return {
    number_id: numberId || null,
    connection_id: numberId ? null : connectionId || null,
  };
}

function senderFields() {
  const sender = platformWhatsAppSender();
  if (sender.number_id) return { number_id: sender.number_id };
  if (sender.connection_id) return { connection_id: sender.connection_id };
  throw new Error('Set SAUTIKIT_WHATSAPP_NUMBER_ID or SAUTIKIT_WHATSAPP_CONNECTION_ID');
}

function buildLeadText({ businessName, name, reason, callerNumber, recordingUrl }) {
  const lines = [
    `New missed-call lead${businessName ? ` (${businessName})` : ''}`,
    `Name: ${name || '-'}`,
    `Phone: ${callerNumber || '-'}`,
    `Reason: ${reason || '-'}`,
  ];
  if (recordingUrl) lines.push(`Recording: ${recordingUrl}`);
  return lines.join('\n');
}

function buildWhatsAppSendPayload({ to, body, lead = {}, windowOpen = false } = {}) {
  const toNorm = normalizeWhatsAppTo(to);
  if (!toNorm) throw new Error('WhatsApp destination number is empty');
  const templateName = process.env.SAUTIKIT_WHATSAPP_TEMPLATE;
  const templateLang = process.env.SAUTIKIT_WHATSAPP_TEMPLATE_LANG || 'en';
  const useTemplate = Boolean(templateName) && !windowOpen;

  if (useTemplate) {
    return {
      ...senderFields(),
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
  }

  return {
    ...senderFields(),
    to: toNorm,
    type: 'text',
    text: {
      body: body || buildLeadText(lead),
      preview_url: Boolean(lead.recordingUrl),
    },
  };
}

async function sautikitWhatsAppPost(path, payload) {
  const apiKey = process.env.SAUTIKIT_API_KEY;
  if (!apiKey) throw new Error('SAUTIKIT_API_KEY is not configured');
  const res = await fetch(`${SAUTIKIT_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

/**
 * Send a WhatsApp message through SautiKit from the Scalers platform number.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.body  free-form text (24h window) OR template fallback
 * @param {object} [opts.lead] structured fields for template components
 * @param {boolean} [opts.windowOpen] force session-window text
 * @param {Date|string|null} [opts.lastInboundAt]
 */
async function sendOwnerWhatsApp({ to, body, lead = {}, windowOpen, lastInboundAt } = {}) {
  let open = windowOpen === true;
  if (windowOpen !== true && windowOpen !== false) {
    if (lastInboundAt) {
      open = isWhatsAppSessionOpen(lastInboundAt, new Date());
    } else {
      try {
        const db = require('../db');
        const session = await db.getWhatsAppSession({
          phoneNumberId:
            process.env.SAUTIKIT_WHATSAPP_PHONE_NUMBER_ID ||
            process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID ||
            '1237105982825100',
          contactWaId: normalizeWhatsAppTo(to),
        });
        open = isWhatsAppSessionOpen(session?.last_inbound_at, new Date());
      } catch {
        open = false;
      }
    }
  }
  const payload = buildWhatsAppSendPayload({ to, body, lead, windowOpen: open });
  const { status, json, text } = await sautikitWhatsAppPost('/v1/whatsapp/messages', payload);
  if (status !== 202 && status !== 200) {
    const err = new Error(`SautiKit WhatsApp send failed: ${status} ${text.slice(0, 300)}`);
    err.status = status;
    err.body = json;
    throw err;
  }
  return json;
}

async function markWhatsAppRead(wamid) {
  const id = String(wamid || '').trim();
  if (!id) return { ok: false, reason: 'no_wamid' };
  const { status, json } = await sautikitWhatsAppPost(
    `/v1/whatsapp/messages/${encodeURIComponent(id)}/read`,
    {}
  );
  if (status !== 202 && status !== 200) {
    const err = new Error(`SautiKit WhatsApp read failed: ${status}`);
    err.status = status;
    err.body = json;
    throw err;
  }
  return json || { ok: true };
}

module.exports = {
  isWhatsAppConfigured,
  normalizeWhatsAppTo,
  buildLeadText,
  platformWhatsAppSender,
  buildWhatsAppSendPayload,
  sendOwnerWhatsApp,
  markWhatsAppRead,
};
