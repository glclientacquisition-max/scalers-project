// Catalogue mouth. Default: Voice speaks the file list (local line).
// BRAIN_GEMINI_CATALOGUE=on is a staging listen only: Gemini speaks, and the
// names must be the exact items[]. Flip the env off to revert that mouth.
// Detail asks and the yes after a name confirm never re-list, flag on or off.

const { normalizeServices } = require('./liveKnowledge');
const { offerCatalogueLine } = require('./knownFacts');
const {
  looksLikeNewWork,
  looksLikeOfferAsk,
  looksLikeServiceDetailAsk,
} = require('./fileRead');

const STOP = new Set([
  'we', 'offer', 'tuna', 'which', 'one', 'do', 'you', 'need', 'the', 'and', 'na',
  'more', 'zingine', 'unahitaji', 'gani', 'our', 'your', 'services', 'service',
  'with', 'for', 'are', 'to', 'of', 'about', 'details', 'detail', 'please',
  'okay', 'sawa', 'can', 'help', 'that', 'this', 'them', 'also', 'just', 'sure',
  'yes', 'yeah', 'right', 'well', 'here', 'today', 'leo', 'what', 'would', 'like',
  'from', 'have', 'has', 'some', 'any', 'these', 'those', 'both', 'huduma', 'ni',
  'ya', 'za', 'kwa', 'au', 'pia', 'tunatoa', 'kusaidia', 'bei', 'note', 'notes',
  'includes', 'include', 'only', 'then', 'how', 'else',
]);

function geminiCatalogueEnabled() {
  return /^(1|true|on|yes)$/i.test(String(process.env.BRAIN_GEMINI_CATALOGUE || '').trim());
}

function mouthServiceName(name) {
  return String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact spoken names from the file. Parenthetical notes stay off the mouth. */
function catalogueItemNames(profile = {}) {
  const rows = normalizeServices(profile.servicesCatalog);
  const names = [];
  for (const row of rows) {
    const name = mouthServiceName(row.name);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function itemsFrom(profile, state) {
  const fromProfile = catalogueItemNames(profile);
  if (fromProfile.length) return fromProfile;
  return Array.isArray(state?.catalogueItems)
    ? state.catalogueItems.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
}

function freshCatalogueAsk(text) {
  return looksLikeOfferAsk(text) && !looksLikeNewWork(text);
}

function wrapperFor(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') {
    return { opener: 'Tuna', closer: 'Unahitaji gani?', more: 'na zingine' };
  }
  return { opener: 'We offer', closer: 'Which one do you need?', more: 'and more' };
}

function whichServiceLine(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') return 'Unahitaji huduma gani?';
  return 'Which service do you need?';
}

/**
 * Turn block for Gemini. Empty unless the staging flag is on and this turn
 * is the first catalogue ask.
 */
function formatCatalogueMouthForPrompt(state) {
  if (!geminiCatalogueEnabled()) return '';
  if (state?.caller?.nameJustConfirmed) return '';
  const latest = String((state?.conversation?.answersReceived || []).slice(-1)[0] || '');
  if (!freshCatalogueAsk(latest)) return '';
  const items = itemsFrom({}, state);
  if (!items.length) return '';
  const wrap = wrapperFor(state?.language?.current);
  const cap =
    items.length > 4
      ? `If you cannot say them all, say the first four exact names, then "${wrap.more}". Do not invent the rest.`
      : 'Say every name.';
  return [
    'CATALOGUE MOUTH (speak it; do not read this label):',
    `items: ${JSON.stringify(items)}`,
    'Say these names exactly, in this order. Do not paraphrase, translate, or add a service.',
    `Wrapper only, locked to this call: opener "${wrap.opener}", closer "${wrap.closer}".`,
    cap,
  ].join('\n');
}

function countItems(text, items) {
  const raw = String(text || '');
  return items.filter((name) => name && raw.includes(name)).length;
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeName(name) {
  return String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskItems(sentence, items) {
  let masked = sentence;
  const slots = [];
  const sorted = items.slice().sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (!name || !masked.includes(name)) continue;
    const re = new RegExp(escapeName(name), 'g');
    masked = masked.replace(re, () => {
      const token = `\u0001${slots.length}\u0001`;
      slots.push(name);
      return token;
    });
  }
  return { masked, slots };
}

function contentWords(part) {
  const bare = String(part || '')
    .replace(/\u0001\d+\u0001/g, ' ')
    .replace(/[^A-Za-z']+/g, ' ');
  return bare
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP.has(word.toLowerCase()));
}

function groundSentence(sentence, items) {
  const stripped = sentence.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const { masked, slots } = maskItems(stripped, items);
  const parts = masked.split(/\s*,\s*|\s+(?:and|na|&)\s+/i);
  let dropped = false;
  const kept = [];
  for (const part of parts) {
    const invented = !/\u0001/.test(part) && contentWords(part).length >= 2;
    if (invented) {
      dropped = true;
      continue;
    }
    kept.push(part);
  }
  if (!dropped && stripped === sentence) return sentence;
  if (!dropped) return stripped;
  const restored = kept
    .join(', ')
    .replace(/\u0001(\d+)\u0001/g, (_, index) => slots[Number(index)] || '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.?!])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[, ]+|[, ]+$/g, '')
    .trim();
  return restored;
}

/**
 * Drop invented service phrases. Exact item names stay.
 * @param {string} text
 * @param {string[]} items
 * @param {{ listTurn?: boolean }} [opts]
 */
function groundCatalogueSpeech(text, items, opts = {}) {
  const names = Array.isArray(items) ? items : [];
  if (!names.length) return String(text || '').trim();
  const listTurn = opts.listTurn === true;
  const out = [];
  for (const sentence of splitSentences(text)) {
    const hits = countItems(sentence, names);
    if (!listTurn && hits < 2) {
      out.push(sentence);
      continue;
    }
    const next = groundSentence(sentence, names);
    if (next) out.push(next);
  }
  return out.join(' ').trim();
}

function isRelistSentence(sentence, items) {
  if (countItems(sentence, items) < 3) return false;
  return !/\d/.test(sentence);
}

function serviceFactsLine(text, profile = {}, language = 'en') {
  if (!looksLikeServiceDetailAsk(text)) return '';
  const sw =
    String(language || '').toLowerCase() === 'sw' ||
    String(language || '').toLowerCase() === 'sheng';
  const items = catalogueItemNames(profile);
  const named = items.find((name) => String(text || '').toLowerCase().includes(name.toLowerCase()));
  const rows = normalizeServices(profile.servicesCatalog).filter((row) => {
    const name = mouthServiceName(row.name);
    return name && (!named || name.toLowerCase() === named.toLowerCase());
  });
  const facts = [];
  for (const row of rows) {
    const name = mouthServiceName(row.name);
    const price = String(row.price_range || row.priceRange || '').trim();
    const notes = String(row.notes || '').replace(/\s+/g, ' ').trim();
    if (price) facts.push(sw ? `${name} ni ${price}.` : `${name} is ${price}.`);
    else if (notes) facts.push(`${name}: ${notes}.`);
  }
  if (!facts.length) {
    return sw
      ? 'Sina maelezo zaidi. Unahitaji gani?'
      : "I don't have more detail on file. Which one do you need?";
  }
  const shown = named ? facts.slice(0, 1) : facts.slice(0, 2);
  if (!named && facts.length > shown.length) {
    shown.push(sw ? 'Unahitaji gani?' : 'Which one do you need?');
  }
  return shown.join(' ');
}

function speechAfterNameYes(text, items, language) {
  const kept = splitSentences(text).filter((part) => !isRelistSentence(part, items));
  const joined = groundCatalogueSpeech(kept.join(' '), items, { listTurn: false });
  if (!joined || countItems(joined, items) >= 3) return whichServiceLine(language);
  return joined;
}

function speechForServiceDetails(text, callerText, profile, language, items) {
  const kept = splitSentences(text).filter((part) => !isRelistSentence(part, items));
  const joined = groundCatalogueSpeech(kept.join(' '), items, { listTurn: false });
  const facts = serviceFactsLine(callerText, profile, language);
  if (!joined || countItems(joined, items) >= 3) return facts;
  if (/\d|\bis\b|\bni\b/i.test(joined)) return joined;
  return facts || joined;
}

function markCatalogueSpoken(state) {
  if (state?.conversation) state.conversation.catalogueSpokenThisTurn = true;
}

const FAILED_CATALOGUE =
  /\b(what do you need done|which service would you like|we can help with that|tunaweza kusaidia|ungependa tusaidie)\b/i;

/** A finished list attempt that named nothing on file. A short opener is not one. */
function failedCatalogueAttempt(original) {
  const raw = String(original || '').trim();
  if (!raw) return false;
  if (/,/.test(raw)) return true;
  if (FAILED_CATALOGUE.test(raw)) return true;
  return false;
}

/**
 * Final mouth for a catalogue, detail, or name-yes turn.
 * Gemini text that already uses exact names is kept. Invented names are removed.
 */
function shapeCatalogueMouth(text, opts = {}) {
  const state = opts.state;
  const callerText = String(opts.callerText || '');
  const profile = opts.profile || {};
  const language = opts.language || state?.language?.current || 'en';
  const items = itemsFrom(profile, state);
  const raw = String(text || '').trim();

  if (state?.caller?.nameJustConfirmed) {
    return speechAfterNameYes(raw, items, language);
  }
  if (looksLikeServiceDetailAsk(callerText)) {
    return speechForServiceDetails(raw, callerText, profile, language, items);
  }
  if (!freshCatalogueAsk(callerText) || !items.length) {
    return groundCatalogueSpeech(raw, items, { listTurn: false });
  }

  const grounded = groundCatalogueSpeech(raw, items, { listTurn: true });
  if (countItems(grounded, items) > 0) {
    markCatalogueSpoken(state);
    return grounded;
  }
  // Warmth and the closer stay. The file list is only the guard when this
  // text tried to name services and none of them are on file.
  if (!failedCatalogueAttempt(raw)) return grounded;
  if (state?.conversation?.catalogueSpokenThisTurn) return '';
  const line = offerCatalogueLine(callerText, profile, language);
  if (!line || /what you need done|unahitaji nini/i.test(line)) return grounded;
  markCatalogueSpoken(state);
  return line;
}

module.exports = {
  geminiCatalogueEnabled,
  catalogueItemNames,
  formatCatalogueMouthForPrompt,
  groundCatalogueSpeech,
  serviceFactsLine,
  shapeCatalogueMouth,
  whichServiceLine,
  freshCatalogueAsk,
};
