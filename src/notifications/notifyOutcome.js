// What actually reached staff, per channel.
//
// `whatsapp_sent` used to be written true whenever any channel accepted an
// alert. Prod HD_d3900cbf2b2d (2026-10-09 20:19 EAT): SMS 402 "Insufficient
// credits", WhatsApp 502 x3, email accepted; the summary said
// whatsapp_sent:true. The call is still "owner notified" (dedupe), but
// WhatsApp is only marked sent when WhatsApp delivered, and the channel map
// records each failure.

const CHANNELS = ['sms', 'whatsapp', 'email'];

function channelOfError(entry) {
  const text = String(entry || '');
  // dispatchAlert: "sms:<reason>"; dispatchToStaff may prefix "<name>:".
  for (const ch of CHANNELS) {
    if (text.startsWith(`${ch}:`) || text.includes(`:${ch}:`)) return ch;
  }
  return null;
}

/**
 * @param {Array<{ channel?: string|null, errors?: string[] }>} sent accepted results
 * @param {string[]} [failures] errors from results that did not land
 * @returns {{ owner_notified: boolean, owner_notify_channel: string|null, owner_notify_channels: Record<string, 'sent'|'failed'>, whatsapp_delivered: boolean }}
 */
function buildNotifyOutcome(sent = [], failures = []) {
  /** @type {Record<string, 'sent'|'failed'>} */
  const channels = {};
  const list = Array.isArray(sent) ? sent.filter(Boolean) : [];
  const allErrors = [
    ...list.flatMap((r) => (Array.isArray(r.errors) ? r.errors : [])),
    ...(Array.isArray(failures) ? failures : []),
  ];
  for (const err of allErrors) {
    const ch = channelOfError(err);
    if (ch && channels[ch] !== 'sent') channels[ch] = 'failed';
  }
  for (const r of list) {
    if (r.channel && CHANNELS.includes(r.channel)) channels[r.channel] = 'sent';
  }
  const first = list.find((r) => r.channel) || null;
  return {
    owner_notified: Boolean(first),
    owner_notify_channel: first ? first.channel : null,
    owner_notify_channels: channels,
    whatsapp_delivered: channels.whatsapp === 'sent',
  };
}

/** A call already alerted staff on some channel (dedupe marker). */
function ownerAlreadyNotified(call = {}) {
  return Boolean(call && (call.owner_notified || call.whatsapp_sent));
}

module.exports = {
  buildNotifyOutcome,
  ownerAlreadyNotified,
  channelOfError,
};
