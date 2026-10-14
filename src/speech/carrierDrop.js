// Carrier media drop: WebSocket close 1006 without a prior Completed webhook.
// Flags the call row (summary.carrier_drop) and optionally opens a callback
// service_request when VOICE_CARRIER_DROP_CALLBACK=on.
// Covers HD_8bd4ebc460d4 / HD_fe30244cfac1 / HD_9ed756701096.

const ON = new Set(['on', '1', 'true', 'yes']);

function carrierDropCallbackEnabled(env = process.env) {
  return ON.has(String(env.VOICE_CARRIER_DROP_CALLBACK || 'off').trim().toLowerCase());
}

/**
 * @param {{ code?: number, completedBeforeClose?: boolean }} info
 */
function isCarrierDropClose(info = {}) {
  const code = Number(info.code);
  if (code !== 1006) return false;
  if (info.completedBeforeClose === true) return false;
  return true;
}

/**
 * Whether the call had an in-flight request worth a callback task.
 * @param {object|null} brainState
 */
function requestInFlight(brainState) {
  if (!brainState || typeof brainState !== 'object') return false;
  const conv = brainState.conversation || {};
  if (conv.pendingToolOutcome) return true;
  if (Array.isArray(conv.recentServiceRequests) && conv.recentServiceRequests.length) return true;
  const intent = String(brainState.intent?.id || brainState.intent || '').toLowerCase();
  if (/book|callback|appointment|order|hold|enquiry|visit/.test(intent)) return true;
  const slots = brainState.slots || {};
  if (slots.service || slots.item || slots.when) return true;
  return false;
}

module.exports = {
  carrierDropCallbackEnabled,
  isCarrierDropClose,
  requestInFlight,
};
