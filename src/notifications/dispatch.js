// Unified owner/teammate alert dispatch.
//
// Private-beta order: SMS (TextSMS.co.ke) → WhatsApp (SautiKit) → email (Resend).
// No live channel: server.js persists failed notify. Desk shows notify failed.
//
// Event model: `src/notifications/events.js` builds one typed event per alert.
// This module renders it per channel and sends. Contract: docs/product/CALL_MESSAGE_CONTRACT.md.

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
const {
  beginInstanceSend,
  claimTenantSms,
  durableSendClaim,
  personKey,
  recordDispatchResult,
  releaseInstanceFlight,
  sendReserved,
} = require('./sendLedger');

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

async function trySendWhatsApp({ to, body, lead, kind }) {
  const dest = normalizeWhatsAppTo(to);
  if (!whatsAppSenderReady() || !dest) return null;
  const result = await sendOwnerWhatsApp({ to: dest, body, lead, kind });
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
async function dispatchAlert({ to, email, body, lead = {}, subject, channels, ledger, kind } = {}) {
  const text = body || buildLeadText(lead);
  const errors = [];
  const prefs = parseNotifyChannels(channels);
  const dests = [normalizeSmsTo(to), normalizeWhatsAppTo(to), normalizeEmail(email)].filter(
    Boolean
  );
  const gate = await beginInstanceSend(ledger, dests);
  if (!gate.ok) {
    return { channel: null, reason: gate.reason };
  }

  // Reserve -> send -> settle under ONE per-person key. A failed or refused
  // SMS is released and the same row is re-armed for WhatsApp/email.
  const ledgerKind = kind || (ledger && ledger.kind);
  const key =
    ledger && typeof ledger === 'object'
      ? personKey({ ...ledger, kind: ledgerKind }, { to, email })
      : null;
  let legacy = !key;

  async function viaReserve(channel, dest, send) {
    const out = await sendReserved(
      { ledger, key, kind: ledgerKind, channel, to: dest, body: text, strict: ledger?.strict },
      send
    );
    if (out.legacy) legacy = true;
    return out;
  }

  // Legacy path (reserve_notify_send not applied yet): record after the send.
  async function accept(result) {
    if (result?.channel) {
      const recorded = await recordDispatchResult(ledger, result, text);
      const claim = durableSendClaim(recorded);
      if (!claim.ok) {
        return { channel: null, reason: claim.reason };
      }
    }
    return result;
  }

  try {
    if (prefs.sms) {
      const smsTo = normalizeSmsTo(to);
      if (smsSenderReady() && smsTo) {
        let handled = false;
        if (!legacy) {
          try {
            const out = await viaReserve('sms', smsTo, async () => {
              const sms = await trySendSms({ to, body: text });
              if (!sms) throw new Error('sms_unavailable');
              return sms;
            });
            if (!out.legacy) {
              handled = true;
              if (out.sent) {
                if (ledger && typeof ledger === 'object') ledger.overage = out.overage;
                return out.result;
              }
              if (out.reason === 'instance_already_sent' || out.reason === 'instance_in_flight') {
                return { channel: null, reason: out.reason };
              }
              errors.push(`sms:${out.reason || 'sms_allowance_exhausted'}`);
              console.warn(`[notify] tenant SMS skipped (${out.reason})`);
            }
          } catch (err) {
            handled = true;
            errors.push(`sms:${err?.message || err}`);
            console.warn(
              `[notify] SMS send failed (${err?.message || err}); units released, trying next channel`
            );
          }
        }
        if (!handled) {
          const claim = await claimTenantSms(ledger, text);
          if (!claim.allowed) {
            errors.push(`sms:${claim.reason || 'sms_allowance_exhausted'}`);
            console.warn(
              `[notify] tenant SMS skipped (${claim.reason || 'sms_allowance_exhausted'})`
            );
          } else {
            if (ledger && typeof ledger === 'object') ledger.overage = Boolean(claim.overage);
            try {
              const sms = await trySendSms({ to, body: text });
              if (sms) return accept(sms);
            } catch (err) {
              errors.push(`sms:${err?.message || err}`);
              console.warn(`[notify] SMS send failed (${err?.message || err}); trying next channel`);
            }
          }
        }
      }
    }

    if (prefs.whatsapp) {
      try {
        const waTo = normalizeWhatsAppTo(to);
        if (!legacy && whatsAppSenderReady() && waTo) {
          const out = await viaReserve('whatsapp', waTo, () =>
            trySendWhatsApp({ to, body: text, lead, kind: ledgerKind })
          );
          if (!out.legacy) {
            if (out.sent) return out.result;
            if (out.reason === 'instance_already_sent' || out.reason === 'instance_in_flight') {
              return { channel: null, reason: out.reason };
            }
            errors.push(`whatsapp:${out.reason}`);
          }
        }
        if (legacy) {
          const wa = await trySendWhatsApp({ to, body: text, lead, kind: ledgerKind });
          if (wa) return accept(wa);
        }
      } catch (err) {
        errors.push(`whatsapp:${err?.message || err}`);
        if (!prefs.email || !emailFallbackReady()) {
          throw err;
        }
        console.warn(
          `[notify] WhatsApp send failed (${err?.message || err}); falling back to email`
        );
      }
    }

    if (prefs.email) {
      const mailTo = normalizeEmail(email);
      if (!legacy && emailFallbackReady() && mailTo) {
        const out = await viaReserve('email', mailTo, async () => {
          const mail = await sendEmailFallback({ to: email, body: text, lead, subject });
          if (!mail.channel) throw new Error(mail.reason || 'email_failed');
          return mail;
        });
        if (!out.legacy) {
          if (out.sent) return out.result;
          if (out.reason === 'instance_already_sent' || out.reason === 'instance_in_flight') {
            return { channel: null, reason: out.reason };
          }
          return { channel: null, reason: out.reason || 'send_failed', errors };
        }
      }
      const mail = await sendEmailFallback({
        to: email,
        body: text,
        lead,
        subject,
      });
      if (mail.channel) return accept(mail);

      if (!smsSenderReady() && !whatsAppSenderReady()) {
        return { channel: null, reason: 'no_notify_channel_configured', errors };
      }
      if (!normalizeSmsTo(to) && !normalizeWhatsAppTo(to)) {
        return { channel: null, reason: mail.reason || 'no_destination_number', errors };
      }
      return { channel: null, reason: 'send_failed', errors };
    }

    return { channel: null, reason: 'channels_disabled_by_tenant', errors };
  } finally {
    releaseInstanceFlight(gate.key);
  }
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
  ledger,
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
    ledger,
  });
  if (!result?.channel) {
    const skipped = [];
    skipped.reason = result?.reason || null;
    return skipped;
  }
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
