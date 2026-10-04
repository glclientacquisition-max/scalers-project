// Names that must never be stored as the caller or shown on SMS.
// Live corpus: Haijawekwa, Calling, Callings, Theexact, Where are you.

const JUNK_CALLER_NAMES = new Set([
  'calling',
  'callings',
  'haijawekwa',
  'caller',
  'customer',
  'client',
  'guest',
  'unknown',
  'test',
  'testing',
  'user',
  'theexact',
  'the exact',
  'or the',
  'n/a',
  'na',
  'none',
  'receptionist',
  'agent',
  'assistant',
  'ai',
  'bot',
  // Speech-to-text of "at around". A time filler, never a caller.
  'ataround',
  'at around',
]);

function cleanCallerName(raw) {
  return String(raw || '')
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isJunkCallerName(raw) {
  const name = cleanCallerName(raw);
  if (!name) return true;
  const lower = name.toLowerCase();
  const compact = lower.replace(/[\s'-]+/g, '');
  if (JUNK_CALLER_NAMES.has(lower) || JUNK_CALLER_NAMES.has(compact)) return true;
  if (/^(where|what|when|who|how|why)(\s+are you)?$/i.test(lower)) return true;
  if (compact === 'ataround' || compact === 'atround') return true;
  return false;
}

function sanitizeStoredCallerName(raw) {
  const name = cleanCallerName(raw);
  if (!name || isJunkCallerName(name)) return null;
  return name;
}

module.exports = {
  JUNK_CALLER_NAMES,
  cleanCallerName,
  isJunkCallerName,
  sanitizeStoredCallerName,
};
