/**
 * Tenant notify-channel preferences (SMS / WhatsApp / email).
 * Used by voice dispatch so owner toggles are honored.
 */

const DEFAULTS = Object.freeze({
  sms: true,
  whatsapp: true,
  email: true,
  caller_sms: false,
});

/**
 * @param {unknown} raw
 * @returns {{ sms: boolean, whatsapp: boolean, email: boolean, caller_sms: boolean }}
 */
function parseNotifyChannels(raw) {
  const next = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next;
  if (typeof raw.sms === 'boolean') next.sms = raw.sms;
  if (typeof raw.whatsapp === 'boolean') next.whatsapp = raw.whatsapp;
  if (typeof raw.email === 'boolean') next.email = raw.email;
  if (typeof raw.caller_sms === 'boolean') next.caller_sms = raw.caller_sms;
  // At least one owner channel must stay opted-in. Caller SMS stays off unless set.
  if (!next.sms && !next.whatsapp && !next.email) {
    next.sms = true;
  }
  return next;
}

module.exports = {
  DEFAULT_NOTIFY_CHANNELS: DEFAULTS,
  parseNotifyChannels,
};
