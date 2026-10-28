'use strict';
// Owner / post-call output for BA v2: fixed templates only. No model text, no
// next-best-action reasons, no raw caller text. Slot values are capped and scrubbed.
const OUTCOME = {
  booked: 'Visit booked (requested). Please confirm with the caller.',
  moved: 'Booking moved at the caller\'s request.',
  cancelled: 'Booking cancelled at the caller\'s request.',
  order_saved: 'Pickup order saved.',
  handoff_callback: 'Caller asked for a callback.',
  owner_only_change: 'Caller asked for a change only you can make. Please call back; nothing was changed.',
  complaint: 'Complaint logged. Please call the caller back.',
  answered: 'Question answered. No action needed.',
  abandoned_with_capture: 'Call ended before anything was confirmed. Details captured below.',
  no_action: 'No request made.',
  brain_error: 'The line had a problem during this call. A callback request was saved. Please call the caller back.',
  write_failed: 'The assistant could not save this request. Nothing was booked. Please call the caller back.',
};
const INTENT = { book: 'Book a visit', order: 'Order', cancel: 'Cancel a booking', change: 'Change a booking', address_change: 'Address change', payment_change: 'Payment change', complaint: 'Complaint', handoff: 'Callback', price: 'Price question', availability: 'Availability question', hours: 'Hours question', recall: 'Asked about their file', none: 'General' };
const safe = (v) => String(v == null ? '' : v).replace(/[^\p{L}\p{N} ,.:/+'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
function renderOwnerMessage({ businessName, callerPhone, name, intent, outcome, captured = {} }) {
  const lines = [`New call for ${safe(businessName)}`, `Caller: ${name ? safe(name) : 'Name not given'} (${safe(callerPhone)})`, `Intent: ${INTENT[intent] || INTENT.none}`, `Outcome: ${OUTCOME[outcome] || OUTCOME.no_action}`];
  const keys = ['service', 'when', 'place', 'items', 'booking', 'new_place', 'category', 'note'];
  for (const k of keys) if (captured[k]) lines.push(`${k.replace('_', ' ')}: ${safe(captured[k])}`);
  return lines.join('\n');
}
module.exports = { renderOwnerMessage, OUTCOME, INTENT };
