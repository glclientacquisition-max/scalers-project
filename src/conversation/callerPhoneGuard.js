'use strict';

const { normalizeKenyaE164 } = require('./liveTransferReady');

function key(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return normalizeKenyaE164(trimmed) || trimmed.replace(/[^\d+]/g, '');
}

/**
 * The model's tool marker may carry a `phone`. Before this guard it overrode
 * the verified caller ID (calls.from_number) when storing service_requests /
 * appointments, and caller SMS (hold/visit confirmations) go to that stored
 * number. A model-invented or memory-copied number (e.g. a similar-named
 * contact) could therefore receive another caller's order details.
 *
 * Keep the marker phone only when the caller actually said that number on
 * this call (state.caller.phone from caller_explicit extraction). Otherwise
 * return undefined so the writer falls back to the call's from_number.
 */
function trustedToolPhone(markerPhone, spokenPhone) {
  const marker = key(markerPhone);
  if (!marker) return undefined;
  const spoken = key(spokenPhone);
  if (spoken && spoken === marker) return String(markerPhone).trim();
  return undefined;
}

module.exports = { trustedToolPhone };
