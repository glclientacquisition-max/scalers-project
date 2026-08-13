// Unified owner/teammate alert dispatch.
//
// Private-beta order: SMS (TextSMS.co.ke) → WhatsApp (SautiKit) → email (Resend).
// Desk note soft-success remains in server.js when no channel delivers.

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
async function dispatchAlert({ to, email, body, lead = {}, subject } = {}) {
  const text = body || buildLeadText(lead);
  const errors = [];

  try {
    const sms = await trySendSms({ to, body: text });
    if (sms) return sms;
  } catch (err) {
    errors.push(`sms:${err?.message || err}`);
    console.warn(`[notify] SMS send failed (${err?.message || err}); trying next channel`);
  }

  try {
    const wa = await trySendWhatsApp({ to, body: text, lead });
    if (wa) return wa;
  } catch (err) {
    errors.push(`whatsapp:${err?.message || err}`);
    if (!emailFallbackReady()) {
      // Keep prior behavior: rethrow when email cannot absorb the failure.
      throw err;
    }
    console.warn(
      `[notify] WhatsApp send failed (${err?.message || err}); falling back to email`
    );
  }

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

/**
 * Escalation: SMS teammate → SMS owner → WhatsApp teammate/owner → owner email.
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
  const text = body || buildLeadText(lead);

  const ownerDestSms = normalizeSmsTo(ownerPhone);
  const teammateDestSms = normalizeSmsTo(teammatePhone);
  const ownerDistinctSms =
    ownerDestSms && (!teammateDestSms || ownerDestSms !== teammateDestSms);

  if (smsSenderReady() && teammateDestSms) {
    try {
      const result = await sendSms({ to: teammateDestSms, body: text });
      sent.push({ channel: 'sms', role: 'teammate', to: teammateDestSms, result });
    } catch (err) {
      console.warn(`[notify] teammate SMS failed:`, err?.message || err);
    }
  }

  if (smsSenderReady() && ownerDistinctSms) {
    try {
      const result = await sendSms({ to: ownerDestSms, body: text });
      sent.push({ channel: 'sms', role: 'owner', to: ownerDestSms, result });
    } catch (err) {
      console.warn(`[notify] owner SMS failed:`, err?.message || err);
    }
  }

  // If SMS already delivered to someone, skip WhatsApp duplicate (WA can layer later).
  // If SMS missed everyone, fall through to WhatsApp then email.
  if (!sent.length && whatsAppSenderReady()) {
    if (teammatePhone) {
      try {
        const result = await sendOwnerWhatsApp({
          to: teammatePhone,
          body: text,
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

    if (ownerDistinct) {
      try {
        const result = await sendOwnerWhatsApp({
          to: ownerPhone,
          body: text,
          lead,
        });
        sent.push({ channel: 'whatsapp', role: 'owner', to: ownerDest, result });
      } catch (err) {
        console.warn(`[notify] owner WhatsApp failed:`, err?.message || err);
      }
    }
  }

  if (!sent.length) {
    const mail = await sendEmailFallback({
      to: ownerEmail,
      body: text,
      lead,
      subject: subject || `Escalation${lead.businessName ? ` — ${lead.businessName}` : ''}`,
    });
    if (mail.channel) {
      sent.push({ channel: 'email', role: 'owner', to: mail.to, result: mail.result });
    }
  }

  // Optional second channel: owner email when a phone channel already succeeded.
  if (
    sent.length &&
    !sent.some((s) => s.channel === 'email') &&
    emailFallbackReady() &&
    ownerEmail
  ) {
    try {
      const mail = await sendEmailFallback({
        to: ownerEmail,
        body: text,
        lead,
        subject: subject || `Escalation${lead.businessName ? ` — ${lead.businessName}` : ''}`,
      });
      if (mail.channel) {
        sent.push({ channel: 'email', role: 'owner', to: mail.to, result: mail.result });
      }
    } catch (err) {
      console.warn(`[notify] owner email secondary failed:`, err?.message || err);
    }
  }

  return sent;
}

module.exports = {
  dispatchAlert,
  dispatchEscalationAlert,
  whatsAppSenderReady,
  emailFallbackReady,
  smsSenderReady,
};
