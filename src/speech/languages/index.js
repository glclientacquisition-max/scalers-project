// Spoken language is data. Adding a language is a pack file, not a code edit.
// Mixed Kenya calls use the Kiswahili pack, same rule as confirmationLanguage.

const en = require('./en.json');
const sw = require('./sw.json');
const shengOver = require('./sheng.json');

function mergePack(base, over) {
  const extra = over || {};
  return {
    ...base,
    ...extra,
    id: extra.id || base.id,
    tails: extra.tails || base.tails,
    phrases: extra.phrases || base.phrases,
    holdUtterances: extra.holdUtterances || base.holdUtterances,
    openers: extra.openers || base.openers,
    fillerBanSources: extra.fillerBanSources || base.fillerBanSources,
    fillerBanWhenAskedSources: extra.fillerBanWhenAskedSources || base.fillerBanWhenAskedSources,
    callbackPitchSources: extra.callbackPitchSources || base.callbackPitchSources,
    offerAsk: extra.offerAsk || base.offerAsk,
    recognitionPhrases: extra.recognitionPhrases || base.recognitionPhrases,
    canned: { ...(base.canned || {}), ...(extra.canned || {}) },
  };
}

const PACKS = {
  en,
  sw,
  sheng: mergePack(sw, shengOver),
};

function spokenLanguage(lang) {
  const code = String(lang || 'en').toLowerCase();
  if (code === 'sw' || code === 'sheng') return code;
  if (code === 'mixed') return 'sw';
  return 'en';
}

function packFor(lang) {
  return PACKS[spokenLanguage(lang)] || PACKS.en;
}

function canned(lang, key, vars = {}) {
  const pack = packFor(lang);
  const fallback = PACKS.en.canned[key];
  let line = pack.canned[key] != null ? pack.canned[key] : fallback || '';
  for (const [name, value] of Object.entries(vars || {})) {
    line = String(line).split(`{${name}}`).join(String(value));
  }
  return line;
}

function uniqueSources(key) {
  const seen = new Set();
  const out = [];
  for (const pack of Object.values(PACKS)) {
    for (const item of pack[key] || []) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileSources(key) {
  const parts = uniqueSources(key).filter(Boolean);
  if (!parts.length) return /$^/;
  return new RegExp(parts.join('|'), 'i');
}

let tailPatternCache = null;
function incompleteTailPattern() {
  if (tailPatternCache) return tailPatternCache;
  const tails = uniqueSources('tails').map(escapeRegExp);
  tailPatternCache = new RegExp(`\\b(?:${tails.join('|')})\\s*$`, 'i');
  return tailPatternCache;
}

let phrasePatternCache = null;
function incompletePhrasePattern() {
  if (phrasePatternCache) return phrasePatternCache;
  const phrases = uniqueSources('phrases').map(escapeRegExp);
  phrasePatternCache = new RegExp(`(?:^|\\b)(?:${phrases.join('|')})\\s*$`, 'i');
  return phrasePatternCache;
}

function holdUtterancePatterns() {
  return uniqueSources('holdUtterances').map((source) => new RegExp(source, 'i'));
}

let openerPatternCache = null;
function openerPattern() {
  if (openerPatternCache) return openerPatternCache;
  const openers = uniqueSources('openers').map(escapeRegExp);
  openerPatternCache = new RegExp(`(?:^|[\\s.!?])(?:${openers.join('|')})$`, 'i');
  return openerPatternCache;
}

let offerAskCache = null;
function offerAskPattern() {
  if (offerAskCache) return offerAskCache;
  const parts = uniqueSources('offerAsk').filter(Boolean);
  offerAskCache = new RegExp(`\\b(?:${parts.join('|')})\\b`, 'i');
  return offerAskCache;
}

function recognitionPhrases() {
  return uniqueSources('recognitionPhrases');
}

function fillerBanPattern() {
  return compileSources('fillerBanSources');
}

function fillerBanWhenAskedPattern() {
  return compileSources('fillerBanWhenAskedSources');
}

function callbackPitchPattern() {
  return compileSources('callbackPitchSources');
}

module.exports = {
  PACKS,
  spokenLanguage,
  packFor,
  canned,
  incompleteTailPattern,
  incompletePhrasePattern,
  holdUtterancePatterns,
  openerPattern,
  offerAskPattern,
  recognitionPhrases,
  fillerBanPattern,
  fillerBanWhenAskedPattern,
  callbackPitchPattern,
};
