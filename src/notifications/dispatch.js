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
const { escalationHold, noteInboxOnly } = require('./escalationGate');
const {
  STAFF_SMS_KINDS,
  renderStaffSms,
  renderStaffWhatsApp,
  staffAlert,
  staffSmsTemplateLines,
  toGsm7,
} = require('./templates');
const { renderStaffAlertEmail } = require('./alertEmail');
const { callShortCode } = require('./callShortLink');

function whatsAppSenderReady() {
  return isWhatsAppConfigured();
}

function emailFallbackReady() {
  return isEmailConfigured();
}

function smsSenderReady() {
  return isSmsConfigured();
}

async function sendEmailFallback({ to, body, lead = {}, subject, mail = null } = {}) {
  const dest = normalizeEmail(to);
  if (!emailFallbackReady() || !dest) {
    return {
      channel: null,
      reason: !emailFallbackReady() ? 'email_not_configured' : 'no_alert_email',
    };
  }
  const built = buildLeadEmail(lead);
  // Staff call alerts: HTML card + plain text (alertEmail.js). Others: text as before.
  const result = await sendOwnerEmail({
    to: dest,
    subject: (mail && mail.subject) || subject || built.subject,
    text: (mail && mail.text) || body || built.text,
    html: mail ? mail.html : undefined,
    lead,
  });
  return { channel: 'email', to: dest, result };
}

function deskBaseUrl() {
  return String(process.env.DESK_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.scalers.co.ke').trim() ||
    'https://app.scalers.co.ke';
}

/**
 * Per-channel bodies for a staff call alert (lead, escalation, request, visit,
 * voicemail, callback): one-segment SMS, the same short body on WhatsApp
 * (session text, first line bold) plus the three scalers_staff_alert
 * variables, and the HTML / text email. Other kinds
 * (billing, wallet, ops, caller texts) keep `text` on every channel.
 */
async function staffChannelBodies({ smsBody, text, lead, ledger, kind } = {}) {
  const k = String(kind || (ledger && ledger.kind) || '').trim();
  const explicitSms = smsBody && String(smsBody).trim() ? toGsm7(smsBody) : null;
  if (!STAFF_SMS_KINDS.has(k)) return { smsText: explicitSms || text, wa: null, mail: null };
  const safeLead = lead && typeof lead === 'object' ? lead : {};
  const shortCode = await callShortCode(ledger);
  const deskBase = deskBaseUrl();
  const smsText = explicitSms || renderStaffSms({ kind: k, lead: safeLead, shortCode, deskBase }) || text;
  const wa = {
    sessionBody: renderStaffWhatsApp({ kind: k, lead: safeLead, shortCode, deskBase }),
    alertLines: staffSmsTemplateLines({ kind: k, lead: safeLead }),
  };
  const alert = staffAlert({ kind: k, lead: safeLead, body: text, shortCode, deskBase, callId: ledger && ledger.callId });
  return { smsText, wa, mail: alert ? renderStaffAlertEmail(alert) : null };
}

async function trySendSms({ to, body }) {
  const dest = normalizeSmsTo(to);
  if (!smsSenderReady() || !dest) return null;
  const result = await sendSms({ to: dest, body });
  return { channel: 'sms', to: dest, result };
}

async function trySendWhatsApp({ to, body, lead, kind, wa = null }) {
  const dest = normalizeWhatsAppTo(to);
  if (!whatsAppSenderReady() || !dest) return null;
  const result = await sendOwnerWhatsApp({
    to: dest,
    body,
    lead,
    kind,
    sessionBody: wa ? wa.sessionBody : undefined,
    alertLines: wa ? wa.alertLines : undefined,
  });
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
async function dispatchAlert({ to, email, body, smsBody, lead = {}, subject, channels, ledger, kind } = {}) {
  const text = body || buildLeadText(lead);
  // Staff call alerts: one GSM-7 segment on SMS (renderStaffSms), the same
  // short body on WhatsApp (renderStaffWhatsApp, first line bold) and an HTML
  // card on email (alertEmail.js). Everything else keeps `text`.
  const { smsText, wa, mail } = await staffChannelBodies({ smsBody, text, lead, ledger, kind });
  const waText = (wa && wa.sessionBody) || text;
  const mailText = (mail && mail.text) || text;
  const errors = [];
  const prefs = parseNotifyChannels(channels);
  const dests = [normalizeSmsTo(to), normalizeWhatsAppTo(to), normalizeEmail(email)].filter(
    Boolean
  );
  const gate = await beginInstanceSend(ledger, dests);
  if (!gate.ok) {
    return { channel: null, reason: gate.reason };
  }
  // #775: voicemails and call updates stay in the Inbox while the business is
  // out of usage. Missing RPC or an error sends as today (escalationGate.js).
  const hold = await escalationHold(ledger);
  if (hold) {
    releaseInstanceFlight(gate.key);
    await noteInboxOnly(ledger, hold.reason);
    console.warn(
      `[notify] held for Inbox (${hold.reason}) kind=${(ledger && ledger.kind) || kind || 'unknown'}` +
        (ledger?.callSid ? ` call=${ledger.callSid}` : '')
    );
    return { channel: null, reason: 'escalation_held', held: hold.reason };
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
      {
        ledger,
        key,
        kind: ledgerKind,
        channel,
        to: dest,
        body: channel === 'sms' ? smsText : channel === 'whatsapp' ? waText : channel === 'email' ? mailText : text,
        strict: ledger?.strict,
      },
      send
    );
    if (out.legacy) legacy = true;
    return out;
  }

  // Legacy path (reserve_notify_send not applied yet): record after the send.
  async function accept(result) {
    if (result?.channel) {
      const sentBody =
        result.channel === 'sms' ? smsText : result.channel === 'whatsapp' ? waText : result.channel === 'email' ? mailText : text;
      const recorded = await recordDispatchResult(ledger, result, sentBody);
      const claim = durableSendClaim(recorded);
      if (!claim.ok) {
        return { channel: null, reason: claim.reason, errors: [...errors] };
      }
    }
    // Channels that failed before this one landed (notifyOutcome.js).
    return result && typeof result === 'object' ? { ...result, errors: [...errors] } : result;
  }

  try {
    if (prefs.sms) {
      const smsTo = normalizeSmsTo(to);
      if (smsSenderReady() && smsTo) {
        let handled = false;
        if (!legacy) {
          try {
            const out = await viaReserve('sms', smsTo, async () => {
              const sms = await trySendSms({ to, body: smsText });
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
          const claim = await claimTenantSms(ledger, smsText);
          if (!claim.allowed) {
            errors.push(`sms:${claim.reason || 'sms_allowance_exhausted'}`);
            console.warn(
              `[notify] tenant SMS skipped (${claim.reason || 'sms_allowance_exhausted'})`
            );
          } else {
            if (ledger && typeof ledger === 'object') ledger.overage = Boolean(claim.overage);
            try {
              const sms = await trySendSms({ to, body: smsText });
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
            trySendWhatsApp({ to, body: text, lead, kind: ledgerKind, wa })
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
          const waSent = await trySendWhatsApp({ to, body: text, lead, kind: ledgerKind, wa });
          if (waSent) return accept(waSent);
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
          const sent = await sendEmailFallback({ to: email, body: text, lead, subject, mail });
          if (!sent.channel) throw new Error(sent.reason || 'email_failed');
          return sent;
        });
        if (!out.legacy) {
          if (out.sent) return out.result;
          if (out.reason === 'instance_already_sent' || out.reason === 'instance_in_flight') {
            return { channel: null, reason: out.reason };
          }
          return { channel: null, reason: out.reason || 'send_failed', errors };
        }
      }
      const sentMail = await sendEmailFallback({
        to: email,
        body: text,
        lead,
        subject,
        mail,
      });
      if (sentMail.channel) return accept(sentMail);

      if (!smsSenderReady() && !whatsAppSenderReady()) {
        return { channel: null, reason: 'no_notify_channel_configured', errors };
      }
      if (!normalizeSmsTo(to) && !normalizeWhatsAppTo(to)) {
        return { channel: null, reason: sentMail.reason || 'no_destination_number', errors };
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
