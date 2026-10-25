'use strict';
// A4 Ops sender: exactly ONE owner message per call, built only from Brain's
// typed `call.summary.ready` event (src/conversation/callSummaryEvent.js,
// contract docs/explanation/brain/CALL_SUMMARY_EVENT.md, schemaVersion 1).
//
// Flags (all default off; staging first):
//   CALL_SUMMARY_EVENT=on            Brain emits the event (Brain's flag).
//   OWNER_CALL_SUMMARY=on            this sender runs. Needs CALL_SUMMARY_EVENT,
//                                    otherwise every answered call would only
//                                    get the "no details captured" fallback.
//   OWNER_SUMMARY_SUPPRESS_LEGACY=on the old mid-call / per-tool / hangup owner
//                                    lead, request and appointment staff sends
//                                    stop (server.js). Only takes effect while
//                                    the sender itself is on, so owners are
//                                    never left with no message at all.
//
// Behaviour (Ops spec /workspace/briefs/a4-owner-summary-sender-spec.md):
// - Settle ~30 s after call end, then send from the latest stored event.
// - urgent (escalation receipt) skips the settle: sends as soon as the call
//   end is known. Still once per call.
// - A re-emit ({ replaces: true }) after a send never resends: the new copy is
//   already on calls.summary.call_summary_event for the Desk.
// - No event 2 min after call end: fallback "Missed call from X" (never
//   answered) or "Call from X, no details captured" (answered).
// - Dedup: in-process per call, durable marker calls.summary.owner_summary_sent_at,
//   and one notify_sends row per (call, kind=call_summary, person) via the
//   reserve/settle ledger, so SMS -> WhatsApp -> email fallback can never count twice.
// - Channel order per person: WhatsApp session text if the 24 h window is
//   open, else SMS, else email.

const { callSummaryEventEnabled } = require('../conversation/callSummaryEvent');
const { staffRecipients } = require('../conversation/teamPermissions');
const { renderOwnerSummary, renderFallback } = require('./ownerSummaryText');
const { buildNotifyOutcome } = require('./notifyOutcome');
const { effectiveChannels, alertTypeFor } = require('./notifyChannels');

const KIND = 'call_summary';
const SETTLE_MS = 30 * 1000;
const FALLBACK_MS = 2 * 60 * 1000;
// An event with no call-end notice (should not happen: Brain emits from the
// hangup finalizer). Send anyway after this, so nothing is silently dropped.
const EVENT_ONLY_MAX_WAIT_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;
const DEDUPE_REASONS = new Set([
  'instance_already_sent',
  'instance_in_flight',
  'tenant_line_closed',
  'table_missing',
]);

function flagOn(raw) {
  return /^(1|true|on|yes)$/i.test(String(raw || '').trim());
}

function ownerCallSummaryEnabled(env) {
  const raw = env ? env.OWNER_CALL_SUMMARY : process.env.OWNER_CALL_SUMMARY;
  return flagOn(raw) && callSummaryEventEnabled(env);
}

/** server.js: skip the old owner lead / request / appointment staff sends. */
function legacyOwnerSendsSuppressed(env) {
  const raw = env ? env.OWNER_SUMMARY_SUPPRESS_LEGACY : process.env.OWNER_SUMMARY_SUPPRESS_LEGACY;
  return ownerCallSummaryEnabled(env) && flagOn(raw);
}

function parseMeta(summary) {
  if (!summary) return {};
  if (typeof summary === 'object') return summary;
  try {
    const parsed = JSON.parse(summary);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function answeredStatus(status) {
  const s = String(status || '').toLowerCase();
  return !(s === 'failed' || s === 'no_answer' || s === 'busy' || s === 'canceled' || s === 'cancelled');
}

async function whatsAppWindowOpen(phone) {
  try {
    const { normalizeWhatsAppTo } = require('./whatsapp');
    const { isWhatsAppSessionOpen } = require('../sautikit/whatsappInbound');
    const contactWaId = normalizeWhatsAppTo(phone);
    if (!contactWaId) return false;
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
    const db = require('../db');
    if (typeof db.getWhatsAppSession !== 'function') return false;
    const session = await db.getWhatsAppSession({
      // Same platform sender default as sendOwnerWhatsApp.
      phoneNumberId:
        process.env.SAUTIKIT_WHATSAPP_PHONE_NUMBER_ID ||
        process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID ||
        '1237105982825100',
      contactWaId,
    });
    return isWhatsAppSessionOpen(session?.last_inbound_at, new Date());
  } catch {
    return false;
  }
}

/**
 * One person, one message: WhatsApp session text when the 24 h window is
 * open, else SMS, else email. Both legs share ONE ledger key (personKey), so a
 * failed WhatsApp re-arms the same notify_sends row for SMS/email.
 */
async function sendOwnerSummaryToPerson({
  person,
  body,
  subject,
  lead,
  channels,
  ledger,
  windowOpen = whatsAppWindowOpen,
  dispatch,
  alertType = null,
} = {}) {
  const { dispatchAlert, whatsAppSenderReady } = require('./dispatch');
  const send = dispatch || dispatchAlert;
  // Per-type choices first; the explicit masks below carry no alertType.
  const prefs = effectiveChannels(channels, alertType);
  const errors = [];
  if (prefs.whatsapp && person?.phone && whatsAppSenderReady() && (await windowOpen(person.phone))) {
    try {
      const wa = await send({
        to: person.phone,
        email: null,
        body,
        lead,
        subject,
        channels: { sms: false, whatsapp: true, email: false },
        ledger,
      });
      if (wa?.channel) return wa;
      if (wa?.reason && DEDUPE_REASONS.has(wa.reason)) return wa;
      errors.push(`whatsapp:${wa?.reason || 'send_failed'}`);
    } catch (err) {
      errors.push(`whatsapp:${err?.message || err}`);
    }
  }
  if (!prefs.sms && !prefs.email) {
    return { channel: null, reason: errors.length ? 'send_failed' : 'channels_disabled_by_tenant', errors };
  }
  const rest = await send({
    to: person?.phone || null,
    email: person?.email || null,
    body,
    lead,
    subject,
    channels: { sms: prefs.sms, whatsapp: false, email: prefs.email },
    ledger,
  });
  if (rest && typeof rest === 'object') {
    return { ...rest, errors: [...errors, ...(Array.isArray(rest.errors) ? rest.errors : [])] };
  }
  return { channel: null, reason: 'send_failed', errors };
}

function createOwnerSummarySender(deps = {}) {
  const {
    db,
    sendToPerson = sendOwnerSummaryToPerson,
    callDeskUrl = () => null,
    enabled = () => ownerCallSummaryEnabled(),
    now = () => Date.now(),
    setTimer = (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    clearTimer = (t) => clearTimeout(t),
    settleMs = SETTLE_MS,
    fallbackMs = FALLBACK_MS,
    eventOnlyMaxWaitMs = EVENT_ONLY_MAX_WAIT_MS,
    log = console,
  } = deps;

  const entries = new Map(); // key (calls.id, else CallSid) -> entry
  const aliases = new Map(); // CallSid -> key

  function entryFor(key) {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        key,
        callSid: null,
        call: null,
        event: null,
        endedAt: null,
        status: null,
        sent: false,
        sending: null,
        timers: {},
        result: null,
      };
      entries.set(key, entry);
      if (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        const old = entries.get(oldest);
        if (old) clearAll(old);
        entries.delete(oldest);
      }
    }
    return entry;
  }

  function clearTimerOf(entry, name) {
    if (entry.timers[name]) {
      clearTimer(entry.timers[name]);
      entry.timers[name] = null;
    }
  }

  function clearAll(entry) {
    for (const name of Object.keys(entry.timers)) clearTimerOf(entry, name);
  }

  function arm(entry, name, ms, fn) {
    clearTimerOf(entry, name);
    entry.timers[name] = setTimer(() => {
      entry.timers[name] = null;
      Promise.resolve()
        .then(fn)
        .catch((err) => log.warn?.(`[owner-summary] ${name} failed ${entry.key}:`, err?.message || err));
    }, Math.max(0, ms));
  }

  function scheduleSummary(entry) {
    if (entry.sent || entry.sending || !entry.event) return;
    if (!entry.endedAt) {
      // Mid-call emit (e.g. a visit write persists the summary early): wait
      // for the call end; a hangup re-emit replaces this copy.
      arm(entry, 'eventOnly', eventOnlyMaxWaitMs, () => send(entry, 'summary'));
      return;
    }
    clearTimerOf(entry, 'eventOnly');
    if (entry.event.urgent === true) {
      return send(entry, 'urgent');
    }
    const wait = entry.endedAt + settleMs - now();
    arm(entry, 'settle', wait, () => send(entry, 'summary'));
  }

  /** Brain hook: fn(event, { replaces }). */
  function onEvent(event, meta = {}) {
    if (!enabled()) return { action: 'disabled' };
    // The top-level `event` discriminator is ignored on purpose.
    if (!event || typeof event !== 'object' || event.schemaVersion !== 1 || !event.callId) {
      log.warn?.('[owner-summary] ignored event (schemaVersion/callId)');
      return { action: 'invalid' };
    }
    const entry = entryFor(String(event.callId));
    entry.event = event; // newest wins (also stored on calls.summary by Brain)
    if (entry.sent || entry.sending) {
      log.log?.(
        `[owner-summary] ${event.callId} re-emit after send${meta.replaces ? ' (replaces)' : ''}: Desk copy only, no resend`
      );
      return { action: 'desk_only' };
    }
    scheduleSummary(entry);
    return { action: entry.event.urgent && entry.endedAt ? 'urgent' : 'scheduled' };
  }

  /** server.js: a terminal call event (any status). Idempotent. */
  async function noteCallEnded({ callSid, call, status } = {}) {
    if (!enabled() || !callSid) return { action: 'disabled' };
    let row = call || null;
    if (!row || !row.id) {
      try {
        row = (await db.getCall(callSid)) || row;
      } catch {
        // keep what we have; send() re-reads the row
      }
    }
    if (row && parseMeta(row.summary).kind === 'live_transfer') return { action: 'transfer_leg' };
    const key = String(row?.id || aliases.get(callSid) || callSid);
    // An event keyed by the CallSid (row missing at emit) folds into the row key.
    if (key !== callSid && entries.has(callSid) && !entries.has(key)) {
      const moved = entries.get(callSid);
      entries.delete(callSid);
      moved.key = key;
      entries.set(key, moved);
    }
    aliases.set(callSid, key);
    const entry = entryFor(key);
    entry.callSid = entry.callSid || callSid;
    entry.call = row || entry.call;
    if (status) entry.status = status;
    if (entry.endedAt) return { action: 'already_ended' };
    entry.endedAt = now();
    if (entry.sent || entry.sending) return { action: 'already_sent' };
    arm(entry, 'fallback', fallbackMs, () => {
      if (!entry.event) return send(entry, 'fallback');
      return null;
    });
    if (entry.event) scheduleSummary(entry);
    return { action: 'ended' };
  }

  function send(entry, mode) {
    if (entry.sent) return Promise.resolve(entry.result);
    if (entry.sending) return entry.sending;
    entry.sending = (async () => {
      clearAll(entry);
      const result = await deliver(entry, mode).catch((err) => {
        log.warn?.(`[owner-summary] send failed ${entry.key}:`, err?.message || err);
        return { action: 'error', error: err?.message || String(err) };
      });
      // Once per call, whatever happened: a failure is recorded, not retried
      // into a second message.
      entry.sent = true;
      entry.result = result;
      entry.sending = null;
      return result;
    })();
    return entry.sending;
  }

  async function deliver(entry, mode) {
    const callSid = entry.callSid;
    if (!callSid) {
      log.warn?.(`[owner-summary] ${entry.key}: no CallSid known, cannot address the send`);
      return { action: 'no_call_sid' };
    }
    let call = null;
    try {
      call = await db.getCall(callSid);
    } catch (err) {
      log.warn?.(`[owner-summary] ${callSid} call lookup failed:`, err?.message || err);
    }
    call = call || entry.call;
    // No calls row: a closed / inactive line or a rejected leg. Nothing to summarise.
    if (!call) return { action: 'no_call_row' };
    const meta = parseMeta(call?.summary);
    if (meta.owner_summary_sent_at) return { action: 'already_sent' };
    if (meta.kind === 'live_transfer') return { action: 'transfer_leg' };

    let profile = {};
    try {
      profile = (await db.getTenantProfile({ callSid })) || {};
    } catch (err) {
      log.warn?.(`[owner-summary] ${callSid} tenant lookup failed:`, err?.message || err);
    }
    const businessName = profile.businessName || process.env.BUSINESS_NAME || null;
    const ownerPhone = profile.whatsappNumber || process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
    const ownerEmail = profile.alertEmail || process.env.OWNER_ALERT_EMAIL || null;
    const tenantId = profile.id || call?.tenant_id || entry.event?.tenantId || null;
    const callUrl = callDeskUrl(call?.id || null);

    let rendered;
    if (mode === 'fallback' || !entry.event) {
      rendered = renderFallback({
        answered: answeredStatus(entry.status || call?.status),
        callerName: call?.name || null,
        // Same rule as Brain's event (#837 callerPhoneFrom): from_number, then caller_number, E.164 or null.
        callerPhone: require('../conversation/callSummaryEvent').callerPhoneFrom(call, null),
        businessName,
        callUrl,
        // No call language without a Brain event: English.
        language: 'en',
      });
    } else {
      rendered = renderOwnerSummary(entry.event, { businessName, callUrl });
    }

    const alertType = alertTypeFor({
      kind: KIND,
      outcome: entry.event?.outcome || null,
      status: entry.status || call?.status || null,
      answered: mode === 'fallback' || !entry.event ? answeredStatus(entry.status || call?.status) : undefined,
    });
    const inbox = staffRecipients('inbox', {
      teamDirectory: profile.teamDirectory || [],
      ownerPhone,
      ownerEmail,
    });
    const lead = {
      businessName,
      name: entry.event?.caller?.name || call?.name || null,
      reason: rendered.label,
      callerNumber: entry.event?.caller?.phone || call?.from_number || null,
    };
    const sent = [];
    const errors = [];
    for (const person of inbox.recipients) {
      try {
        const out = await sendToPerson({
          person,
          body: rendered.text,
          subject: rendered.subject,
          lead,
          channels: profile.notifyChannels || null,
          alertType,
          ledger: {
            tenantId,
            callId: call?.id || null,
            callSid,
            kind: KIND,
            recipientId: person.id || null,
          },
        });
        if (out?.channel) sent.push({ ...out, role: 'staff', name: person.name || null });
        else if (out?.reason) errors.push(`${person.name || 'staff'}:${out.reason}`);
        for (const e of Array.isArray(out?.errors) ? out.errors : []) errors.push(`${person.name || 'staff'}:${e}`);
      } catch (err) {
        errors.push(`${person.name || 'staff'}:${err?.message || err}`);
      }
    }

    const first = sent[0] || null;
    try {
      if (first) await db.markWhatsappSent(callSid, buildNotifyOutcome(sent, errors));
      await db.mergeCallSummaryMeta({
        callSid,
        patch: {
          owner_summary_sent_at: new Date(now()).toISOString(),
          owner_summary_mode: mode,
          owner_summary_outcome: entry.event?.outcome || (mode === 'fallback' ? 'fallback' : null),
          owner_summary_recipients: sent.length,
          ...(first
            ? {
                owner_notify_body: rendered.text,
                owner_notify_channel: first.channel,
                owner_notify_kind: KIND,
              }
            : { owner_summary_errors: errors.slice(0, 10) }),
        },
      });
    } catch (err) {
      log.warn?.(`[owner-summary] ${callSid} mark sent failed:`, err?.message || err);
    }
    log.log?.(
      `[owner-summary] ${callSid} mode=${mode} outcome=${entry.event?.outcome || 'none'} ` +
        `sent=${sent.length}/${inbox.recipients.length}${first ? ` via ${first.channel}` : ''}` +
        (errors.length ? ` errors=${errors.join('|')}` : '')
    );
    return { action: 'sent', mode, sent, errors, text: rendered.text, recipients: inbox.recipients.length };
  }

  function _state(key) {
    return entries.get(aliases.get(key) || key) || null;
  }

  function _reset() {
    for (const e of entries.values()) clearAll(e);
    entries.clear();
    aliases.clear();
  }

  return { onEvent, noteCallEnded, flush: send, _state, _reset };
}

module.exports = {
  KIND,
  SETTLE_MS,
  FALLBACK_MS,
  ownerCallSummaryEnabled,
  legacyOwnerSendsSuppressed,
  answeredStatus,
  whatsAppWindowOpen,
  sendOwnerSummaryToPerson,
  createOwnerSummarySender,
};
