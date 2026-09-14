// Missed-call text-back (business → caller whose call reached the line but
// got no service). Off unless tenants.notify_channels.missed_textback is true.
//
// "Missed" here means the terminal webhook closed the call as failed or
// no_answer: the caller heard silence, not the receptionist. Calls the
// receptionist actually served (complete, any resolution) never text-back.

const { sendSms, isSmsConfigured, normalizeSmsTo } = require('./sms');
const { parseNotifyChannels } = require('./notifyChannels');

const TEXTBACK_META_KEY = 'missed_textback_at';

/** Repeat failures to the same caller inside this window text only once. */
const SUPPRESS_WINDOW_MS = 6 * 60 * 60 * 1000;

function missedTextbackEnabled(channels) {
  return parseNotifyChannels(channels).missed_textback === true;
}

/**
 * One fixed template. No reply invite: inbound SMS has no route back to the
 * desk, so the only promise made is the callback, which the Inbox "Missed"
 * queue already surfaces to the owner.
 */
function missedTextbackBody(businessName) {
  const business = String(businessName || '').trim();
  const who = business ? `${business} here` : 'the business you called';
  return `Hi, ${who}. Sorry we missed your call. We will call you back.`;
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

/**
 * @param {object} call  shaped call row (db.shapeCall) or raw row + summary
 * @returns {{ ok: boolean, reason: string }}
 */
function missedCallEligible(call) {
  if (!call) return { ok: false, reason: 'no_call' };
  const status = String(call.status || '').toLowerCase();
  if (status !== 'failed' && status !== 'no_answer') {
    return { ok: false, reason: 'served' };
  }
  const meta = parseMeta(call.summary);
  // An unanswered outbound transfer leg is the teammate's phone ringing out,
  // not a missed customer. The inbound leg carries the customer experience.
  if (meta.kind === 'live_transfer') return { ok: false, reason: 'transfer_leg' };
  if (meta[TEXTBACK_META_KEY]) return { ok: false, reason: 'already_sent' };
  const phone = normalizeSmsTo(call.from_number || call.caller_number);
  if (!phone || phone.length < 9) return { ok: false, reason: 'no_caller_phone' };
  // A captured lead means the caller gave name + reason and the owner alert
  // path owns the follow-up. Never double-notify.
  if (call.name && call.reason) return { ok: false, reason: 'lead_captured' };
  return { ok: true, reason: 'ok' };
}

/**
 * True when another call from this number was texted inside the window.
 * Rows are raw calls rows; summaries parsed here (summary is a text column).
 */
function recentlyTexted(rows, nowMs = Date.now()) {
  return (rows || []).some((row) => {
    const at = Date.parse(parseMeta(row.summary)[TEXTBACK_META_KEY] || '');
    return Number.isFinite(at) && nowMs - at < SUPPRESS_WINDOW_MS;
  });
}

async function sendMissedTextback({ to, businessName } = {}) {
  if (!isSmsConfigured()) return { channel: null, reason: 'sms_not_configured' };
  const dest = normalizeSmsTo(to);
  if (!dest) return { channel: null, reason: 'no_caller_phone' };
  const body = missedTextbackBody(businessName);
  const result = await sendSms({ to: dest, body });
  return { channel: 'sms', to: dest, result, body };
}

module.exports = {
  TEXTBACK_META_KEY,
  SUPPRESS_WINDOW_MS,
  missedTextbackEnabled,
  missedTextbackBody,
  missedCallEligible,
  recentlyTexted,
  sendMissedTextback,
};
