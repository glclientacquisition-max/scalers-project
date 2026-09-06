/** Map runtime intent ids onto desk-facing taxonomy. */
const INTENT_ALIASES = Object.freeze({
  hold: 'hold_or_pickup',
  hold_or_pickup: 'hold_or_pickup',
  hours: 'hours_open',
  hours_open: 'hours_open',
  location: 'directions',
  directions: 'directions',
  order: 'order_enquiry',
  order_enquiry: 'order_enquiry',
  enquiry: 'enquiry',
  callback: 'callback',
  price: 'price',
  availability: 'availability',
  policy: 'policy',
  human: 'human',
  product_inquiry: 'product_inquiry',
  general_enquiry: 'general_enquiry',
  booking: 'book_visit',
  book_visit: 'book_visit',
  cancellation: 'cancel',
  cancel: 'cancel',
  reschedule: 'reschedule',
  service_inquiry: 'service_inquiry',
  service_area: 'service_area',
  price_band: 'price_band',
  emergency: 'emergency',
  complaint: 'complaint',
});

function cleanIntent(value, max = 80) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .toLowerCase();
}

function normalizePrimaryIntent(raw) {
  const key = cleanIntent(raw);
  if (!key || key === 'unknown') return null;
  return INTENT_ALIASES[key] || key;
}

module.exports = {
  INTENT_ALIASES,
  normalizePrimaryIntent,
};
