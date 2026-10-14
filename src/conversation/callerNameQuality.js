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

// Interjections, fillers, greetings, yes/no and courtesy words (EN + SW/Sheng).
// A reply like "Mmh." to "kwa jina gani?" is not a name (HD_9904b41a8ba9).
const NON_NAME_WORDS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah', 'ok', 'okay', 'okey', 'alright', 'right', 'sure', 'fine', 'cool', 'mimi',
  'hello', 'hallo', 'halo', 'hi', 'hey', 'pardon', 'sorry', 'excuse', 'please', 'thanks', 'thank', 'welcome',
  'what', 'who', 'why', 'how', 'when', 'where', 'huh', 'eh', 'mm', 'um', 'uh', 'er', 'ah', 'oh', 'aa',
  'sawa', 'ndio', 'ndiyo', 'eeh', 'ee', 'ehe', 'aha', 'hapana', 'la', 'basi', 'poa', 'fiti', 'sasa', 'niaje', 'mambo',
  'habari', 'jambo', 'hujambo', 'asante', 'karibu', 'samahani', 'nini', 'ati', 'eti', 'kwani', 'wewe', 'mimi', 'yeye',
  'name', 'jina', 'speaking', 'here', 'me', 'i', 'the', 'a', 'and', 'so', 'just', 'like', 'well',
]);

// Courtesy words that are also given names in Kenya. Rejected only when they
// are the whole bare answer; trusted after "my name is" / "naitwa".
const NAME_ALSO_WORD = new Set(['welcome', 'mimi', 'sasa', 'fine', 'sure', 'neema', 'baraka', 'amani', 'imani', 'rehema']);

/**
 * True when the text is a filler / interjection / non-name, not a person's name.
 * explicit: the caller said "my name is …" / "naitwa …" — only interjections,
 * single letters and vowel-less fragments are rejected then.
 * bare: a whole bare answer — courtesy words that double as names are rejected too.
 */
function isNonNameUtterance(raw, { explicit = false, bare = false } = {}) {
  const words = String(raw || '').toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return words.every((w) => {
    if (w.length <= 1) return true; // single letters ("h.")
    if (NAME_ALSO_WORD.has(w)) return bare && !explicit && NON_NAME_WORDS.has(w);
    if (!explicit && NON_NAME_WORDS.has(w)) return true;
    // Pure interjections: mmh, hmm, mhm, uhm, aah, eeh, ooh, ahh, ehh, mmm...
    if (/^(?:m+h*m*|h+m+|m+h+m*|u+h*m+|u+h+|a+h+|e+h+|o+h+|a{2,}|e{2,}h*|o{2,}|i{2,}|h+)$/.test(w)) return true;
    // No vowel at all (STT fragments like "hm", "mhm", "shh", "pfft").
    if (!/[aeiouy]/.test(w)) return true;
    return false;
  });
}

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
  // BRAIN_TRUST_P1: fillers and interjections are never stored as a name.
  if (String(process.env.BRAIN_TRUST_P1 || '').trim() === 'on' && isNonNameUtterance(name)) return true;
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
  isNonNameUtterance,
  NON_NAME_WORDS,
  sanitizeStoredCallerName,
};
