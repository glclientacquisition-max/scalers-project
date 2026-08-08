// Unified owner/teammate alert dispatch.
//
// Scale path (plug-and-play): WhatsApp via SautiKit when sender env is set
// and a destination number exists (per-tenant owner or teammate phone).
// Fallback: email (Resend) to per-tenant alert_email / OWNER_ALERT_EMAIL.
// Telegram is not used.

const {
  isWhatsAppConfigured,
  normalizeWhatsAppTo,
  sendOwnerWhatsApp,
  buildLeadText,
} = require('./whatsapp');
const {
  isEmailConfigured,
  normalizeEmail,
  sendOwnerEmail,
  buildLeadEmail,
} = require('./email');

function whatsAppSenderReady() {
  return isWhatsAppConfigured();
}

function emailFallbackReady() {
  return isEmailConfigured();
}

async function sendEmailFallback({ to, body, lead = {}, subject } = {}) {
  const dest = normalizeEmail(to);
  if (!emailFallbackReady() || !dest) {
    return { channel: null, reason: !emailFallbackReady() ? 'email_not_configured' : 'no_alert_email' };
  }
  const built = buildLeadEmail(lead);
  const result = await sendOwnerEmail({
    to: dest,
    subject: subject || built.subject,
    text: body || built.text,
    lead,
  });
  return { channel: 'email', to: dest, result };
}

/**
 * Send an alert to one destination.
 * Prefers WhatsApp when the SautiKit sender is configured and `to` phone is set.
 * Falls back to email when WhatsApp is unavailable or fails.
 *
 * @param {object} opts
 * @param {string} [opts.to] WhatsApp phone
 * @param {string} [opts.email] Fallback email
 * @param {string} [opts.body]
 * @param {object} [opts.lead]
 * @param {string} [opts.subject]
 */
async function dispatchAlert({ to, email, body, lead = {}, subject } = {}) {
  const dest = normalizeWhatsAppTo(to);
  const text = body || buildLeadText(lead);

  if (whatsAppSenderReady() && dest) {
    try {
      const result = await sendOwnerWhatsApp({ to: dest, body: text, lead });
      return { channel: 'whatsapp', to: dest, result };
    } catch (err) {
      if (!emailFallbackReady()) throw err;
      console.warn(
        `[notify] WhatsApp send failed (${err?.message || err}); falling back to email`
      );
    }
  }

  const mail = await sendEmailFallback({
    to: email,
    body: text,
    lead,
    subject,
  });
  if (mail.channel) return mail;

  if (!whatsAppSenderReady()) {
    return { channel: null, reason: 'whatsapp_sender_not_configured' };
  }
  if (!dest) {
    return { channel: null, reason: mail.reason || 'no_destination_number' };
  }
  return { channel: null, reason: 'send_failed' };
}

/**
 * Escalation: WhatsApp teammate, then owner WhatsApp, then owner email.
 */
async function dispatchEscalationAlert({
  teammatePhone,
  ownerPhone,
  ownerEmail,
  body,
  lead = {},
  subject,
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
      sent.push({
        channel: 'whatsapp',
        role: 'teammate',
        to: normalizeWhatsAppTo(teammatePhone),
        result,
      });
    } catch (err) {
      console.warn(`[notify] teammate WhatsApp failed:`, err?.message || err);
    }
  }

  const ownerDest = normalizeWhatsAppTo(ownerPhone);
  const teammateDest = normalizeWhatsAppTo(teammatePhone);
  const ownerDistinct = ownerDest && (!teammateDest || ownerDest !== teammateDest);

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

  if (!sent.length) {
    const mail = await sendEmailFallback({
      to: ownerEmail,
      body,
      lead,
      subject: subject || `Escalation${lead.businessName ? ` — ${lead.businessName}` : ''}`,
    });
    if (mail.channel) {
      sent.push({ channel: 'email', role: 'owner', to: mail.to, result: mail.result });
    }
  }

  return sent;
}

module.exports = {
  dispatchAlert,
  dispatchEscalationAlert,
  whatsAppSenderReady,
  emailFallbackReady,
};
