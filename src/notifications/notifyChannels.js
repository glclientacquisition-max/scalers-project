/**
 * Tenant notify-channel preferences (SMS / WhatsApp / email / phone push),
 * plus per-alert-type choices in notify_channels.by_type (Desk How we notify).
 * Used by voice dispatch so owner toggles are honored.
 *
 * by_type cells that are missing take the shared defaults in
 * dashboard/src/lib/alertTypeDefaults.json (Alvin GO 25 Oct 2026 12:37 EAT:
 * new defaults apply to existing owners too). Effective send for a type =
 * master channel on AND by_type cell on. Missed calls always keep one channel.
 */

const ALERT_DEFAULTS = require('../../dashboard/src/lib/alertTypeDefaults.json');

const DEFAULTS = Object.freeze({
  sms: true,
  whatsapp: true,
  email: true,
  caller_sms: false,
  missed_textback: false,
});

const ALERT_TYPES = Object.freeze([...ALERT_DEFAULTS.types]);
const ALERT_CHANNELS = Object.freeze([...ALERT_DEFAULTS.channels]);

/**
 * @param {unknown} raw
 * @returns {{ sms: boolean, whatsapp: boolean, email: boolean, caller_sms: boolean, missed_textback: boolean }}
 */
function parseNotifyChannels(raw) {
  const next = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next;
  if (typeof raw.sms === 'boolean') next.sms = raw.sms;
  if (typeof raw.whatsapp === 'boolean') next.whatsapp = raw.whatsapp;
  if (typeof raw.email === 'boolean') next.email = raw.email;
  if (typeof raw.caller_sms === 'boolean') next.caller_sms = raw.caller_sms;
  if (typeof raw.missed_textback === 'boolean') next.missed_textback = raw.missed_textback;
  // Carried through (tenantProfile parses once) so dispatch can read the per-type choices.
  if (typeof raw.push === 'boolean') next.push = raw.push;
  if (raw.by_type && typeof raw.by_type === 'object' && !Array.isArray(raw.by_type)) next.by_type = raw.by_type;
  // At least one owner channel must stay opted-in. Caller SMS stays off unless set.
  if (!next.sms && !next.whatsapp && !next.email) {
    next.sms = true;
  }
  return next;
}

/** Stored row for a type; old keys (message, lead) map to other_calls. */
function storedRow(stored, type) {
  const own = stored[type];
  if (own && typeof own === 'object' && !Array.isArray(own)) return own;
  for (const [old, now] of Object.entries(ALERT_DEFAULTS.legacyKeys || {})) {
    const row = stored[old];
    if (now === type && row && typeof row === 'object' && !Array.isArray(row)) return row;
  }
  return {};
}

/** Full by_type grid: stored cells win, missing cells take the defaults. */
function parseAlertTypes(raw) {
  const stored =
    raw && typeof raw === 'object' && !Array.isArray(raw) && raw.by_type && typeof raw.by_type === 'object'
      ? raw.by_type
      : {};
  const out = {};
  for (const type of ALERT_TYPES) {
    const row = storedRow(stored, type);
    out[type] = {};
    for (const ch of ALERT_CHANNELS) {
      out[type][ch] = typeof row[ch] === 'boolean' ? row[ch] : ALERT_DEFAULTS.defaults[type][ch];
    }
  }
  return out;
}

/** Master push switch: absent = on (device subscription decides). */
function pushMaster(raw) {
  return !(raw && typeof raw === 'object' && raw.push === false);
}

/**
 * Event kind / call outcome -> alert type. Null = not owner-choosable
 * (wallet, outages, urgent escalations): master switches only.
 */
function alertTypeFor({ kind, outcome, status, answered } = {}) {
  const o = String(outcome || '').toLowerCase();
  const k = String(kind || '').toLowerCase();
  if (o === 'missed' || o === 'abandoned') return 'missed_call';
  if (o === 'booked' || o === 'ordered') return 'booking';
  if (k === 'appointment' || k === 'service_request' || k.startsWith('caller_hold') || k === 'caller_order') {
    return 'booking';
  }
  if (k === 'lead' || k === 'caller_callback' || k === 'call_summary' || o) {
    const s = String(status || '').toLowerCase();
    if (answered === false || s === 'failed' || s === 'no_answer') return 'missed_call';
    // Every answered non-booking call: questions, call-back requests, escalations.
    return 'other_calls';
  }
  return null;
}

/**
 * Channels allowed for one alert. With no type, the master switches only
 * (same as parseNotifyChannels). With a type, master AND the by_type cell.
 * @returns {{ sms: boolean, whatsapp: boolean, email: boolean, push: boolean }}
 */
function effectiveChannels(raw, alertType) {
  const master = parseNotifyChannels(raw);
  const push = pushMaster(raw);
  const base = { sms: master.sms, whatsapp: master.whatsapp, email: master.email, push };
  if (!alertType || !ALERT_TYPES.includes(alertType)) return base;
  const cells = parseAlertTypes(raw)[alertType];
  const out = {};
  for (const ch of ALERT_CHANNELS) out[ch] = Boolean(base[ch] && cells[ch]);
  if (alertType === 'missed_call' && !ALERT_CHANNELS.some((ch) => out[ch])) {
    // Never lose a missed call: first master-on channel in guard order.
    const pick = ALERT_DEFAULTS.missedCallGuardOrder.find((ch) => base[ch]) || 'sms';
    out[pick] = true;
  }
  return out;
}

module.exports = {
  DEFAULT_NOTIFY_CHANNELS: DEFAULTS,
  ALERT_TYPE_DEFAULTS: ALERT_DEFAULTS.defaults,
  ALERT_TYPES,
  ALERT_CHANNELS,
  parseNotifyChannels,
  parseAlertTypes,
  alertTypeFor,
  effectiveChannels,
};
