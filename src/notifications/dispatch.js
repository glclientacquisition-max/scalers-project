// Unified owner/teammate alert dispatch.
//
// Scale path (plug-and-play): WhatsApp via SautiKit when sender env is set
// and a destination number exists (per-tenant owner or teammate phone).
// Interim fallback: Telegram (single shared chat) only when WhatsApp is
// not configured or the WhatsApp send fails.

const {
  isWhatsAppConfigured,
  normalizeWhatsAppTo,
  sendOwnerWhatsApp,
  buildLeadText,
} = require('./whatsapp');
const { isTelegramConfigured, sendOwnerTelegram } = require('./telegram');

function whatsAppSenderReady() {
  return isWhatsAppConfigured();
}

function telegramFallbackReady() {
  return isTelegramConfigured();
}

/**
 * Send an alert to one destination.
 * Prefers WhatsApp when the SautiKit sender is configured and `to` is set.
 *
 * @returns {Promise<{ channel: 'whatsapp'|'telegram'|null, to?: string, result?: unknown, reason?: string }>}
 */
async function dispatchAlert({ to, body, lead = {} } = {}) {
  const dest = normalizeWhatsAppTo(to);
  const text = body || buildLeadText(lead);

  if (whatsAppSenderReady() && dest) {
    try {
      const result = await sendOwnerWhatsApp({ to: dest, body: text, lead });
      return { channel: 'whatsapp', to: dest, result };
    } catch (err) {
      if (!telegramFallbackReady()) {
        throw err;
      }
      console.warn(
        `[notify] WhatsApp send failed (${err?.message || err}); falling back to Telegram`
      );
    }
  }

  if (telegramFallbackReady()) {
    const result = await sendOwnerTelegram({ text, lead });
    return { channel: 'telegram', result };
  }

  if (!whatsAppSenderReady()) {
    return { channel: null, reason: 'whatsapp_sender_not_configured' };
  }
  if (!dest) {
    return { channel: null, reason: 'no_destination_number' };
  }
  return { channel: null, reason: 'send_failed' };
}

/**
 * Escalation: WhatsApp teammate first (scale), then owner WhatsApp,
 * then Telegram fallback so the ping is never lost in interim setups.
 */
async function dispatchEscalationAlert({
  teammatePhone,
  ownerPhone,
  body,
  lead = {},
} = {}) {
  const sent = [];
  const waReady = whatsAppSenderReady();

  if (waReady && teammatePhone) {
    try {
      const result = await sendOwnerWhatsApp({
        to: teammatePhone,
        body,
        lead,
      });
      sent.push({ channel: 'whatsapp', role: 'teammate', to: normalizeWhatsAppTo(teammatePhone), result });
    } catch (err) {
      console.warn(`[notify] teammate WhatsApp failed:`, err?.message || err);
    }
  }

  const ownerDest = normalizeWhatsAppTo(ownerPhone);
  const teammateDest = normalizeWhatsAppTo(teammatePhone);
  const ownerDistinct =
    ownerDest && (!teammateDest || ownerDest !== teammateDest);

  if (waReady && ownerDistinct) {
    try {
      const result = await sendOwnerWhatsApp({
        to: ownerPhone,
        body,
        lead,
      });
      sent.push({ channel: 'whatsapp', role: 'owner', to: ownerDest, result });
    } catch (err) {
      console.warn(`[notify] owner WhatsApp failed:`, err?.message || err);
    }
  }

  // No WhatsApp success (sender down, or no phones on file) → interim Telegram.
  if (!sent.length && telegramFallbackReady()) {
    const result = await sendOwnerTelegram({ text: body, lead });
    sent.push({ channel: 'telegram', role: 'owner', result });
  }

  return sent;
}

module.exports = {
  dispatchAlert,
  dispatchEscalationAlert,
  whatsAppSenderReady,
  telegramFallbackReady,
};
