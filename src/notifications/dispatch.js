// Unified owner/teammate alert dispatch.
//
// Private-beta order: SMS (TextSMS.co.ke) → WhatsApp (SautiKit) → email (Resend).
// Desk note soft-success remains in server.js when no channel delivers.
//
// Event model: `src/notifications/events.js` builds one typed event per alert.
// This module renders it per channel and sends. Contract: docs/CALL_MESSAGE_CONTRACT.md.

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
const { isSmsConfigured, normalizeSmsTo, sendSms } = require('./sms');
const { parseNotifyChannels } = require('./notifyChannels');

function whatsAppSenderReady() {
  return isWhatsAppConfigured();
}

function emailFallbackReady() {
  return isEmailConfigured();
}

function smsSenderReady() {
  return isSmsConfigured();
}

async function sendEmailFallback({ to, body, lead = {}, subject } = {}) {
  const dest = normalizeEmail(to);
  if (!emailFallbackReady() || !dest) {
    return {
      channel: null,
      reason: !emailFallbackReady() ? 'email_not_configured' : 'no_alert_email',
    };
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

async function trySendSms({ to, body }) {
  const dest = normalizeSmsTo(to);
  if (!smsSenderReady() || !dest) return null;
  const result = await sendSms({ to: dest, body });
  return { channel: 'sms', to: dest, result };
}

async function trySendWhatsApp({ to, body, lead }) {
  const dest = normalizeWhatsAppTo(to);
  if (!whatsAppSenderReady() || !dest) return null;
  const result = await sendOwnerWhatsApp({ to: dest, body, lead });
  return { channel: 'whatsapp', to: dest, result };
}

/**
 * Send an alert to one destination.
 * Prefers SMS when TextSMS is configured; then WhatsApp; then email.
 *
 * @param {object} opts
 * @param {string} [opts.to] Phone (SMS / WhatsApp)
 * @param {string} [opts.email] Fallback email
 * @param {string} [opts.body]
 * @param {object} [opts.lead]
 * @param {string} [opts.subject]
 */
async function dispatchAlert({ to, email, body, lead = {}, subject, channels } = {}) {
  const text = body || buildLeadText(lead);
  const errors = [];
  const prefs = parseNotifyChannels(channels);

  if (prefs.sms) {
    try {
      const sms = await trySendSms({ to, body: text });
      if (sms) return sms;
    } catch (err) {
      errors.push(`sms:${err?.message || err}`);
      console.warn(`[notify] SMS send failed (${err?.message || err}); trying next channel`);
    }
  }

  if (prefs.whatsapp) {
    try {
      const wa = await trySendWhatsApp({ to, body: text, lead });
      if (wa) return wa;
    } catch (err) {
      errors.push(`whatsapp:${err?.message || err}`);
      if (!prefs.email || !emailFallbackReady()) {
        // Keep prior behavior: rethrow when email cannot absorb the failure.
        throw err;
      }
      console.warn(
        `[notify] WhatsApp send failed (${err?.message || err}); falling back to email`
      );
    }
  }

  if (prefs.email) {
    const mail = await sendEmailFallback({
      to: email,
      body: text,
      lead,
      subject,
    });
    if (mail.channel) return mail;

    if (!smsSenderReady() && !whatsAppSenderReady()) {
      return { channel: null, reason: 'no_notify_channel_configured', errors };
    }
    if (!normalizeSmsTo(to) && !normalizeWhatsAppTo(to)) {
      return { channel: null, reason: mail.reason || 'no_destination_number', errors };
    }
    return { channel: null, reason: 'send_failed', errors };
  }

  return { channel: null, reason: 'channels_disabled_by_tenant', errors };
}

/**
 * Escalation: one permissioned teammate. Do not also SMS the workspace owner.
 */
async function dispatchEscalationAlert({
  teammatePhone,
  teammateEmail,
  ownerPhone,
  ownerEmail,
  body,
  lead = {},
  subject,
  channels,
} = {}) {
  const text = body || buildLeadText(lead);
  const destPhone = teammatePhone || null;
  const destEmail = teammateEmail || null;
  const sameOwner =
    destPhone &&
    ownerPhone &&
    String(destPhone).replace(/\D/g, '') ===
      String(ownerPhone).replace(/\D/g, '');
  const result = await dispatchAlert({
    to: destPhone,
    email: destEmail || (sameOwner ? ownerEmail : null),
    body: text,
    lead,
    subject,
    channels,
  });
  if (!result?.channel) return [];
  return [
    {
      ...result,
      role: 'teammate',
    },
  ];
}

module.exports = {
  dispatchAlert,
  dispatchEscalationAlert,
  whatsAppSenderReady,
  emailFallbackReady,
  smsSenderReady,
};
