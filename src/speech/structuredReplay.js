// Deterministic stand-in for Gemini structured output.
// Recorded mode has the caller transcript and the old model text.
// This builds the JSON the live model is asked for: locked language,
// complete spoken sentences, and the service or price answer when the
// caller asked for one. It does not call the network.
//
// Live calls use structuredGeminiTurn.js. Replay uses this so CI can
// score the new mouth without GEMINI_API_KEY. A business catalog on the
// fixture wins. Otherwise the name below is the stand-in for that shop's
// services list, taken from the calls these fixtures were built from.

const { analyzeCallerLanguage } = require('../conversation/language');
const { getLanguagePack } = require('./languages');
const { createSpokenSentenceParser } = require('./jsonSentenceStream');
const {
  finishSentence,
  normalizeStructuredSentence,
  protectSpokenAnswer,
  repairLine,
  splitSentences,
  validateStructuredReply,
} = require('./structuredReply');
const { applyNameGate } = require('./turnMachine');

const SERVICE_ASK =
  /\b(services?|huduma|mnafanya|mna\s*offer|mnaofa|mna\s*ofa|mnayofanya|unafanya|kenye mko|vitu mnayofanya|mnanifanya)\b/i;
const SERVICE_NOUN =
  /\b(clean(?:ing)?|usafi|fumig\w*|carpet|couch|sofa|mattress|upholstery|counter\s+books?|stationery|kitabu|vitabu|airbnb)\b/i;
const PRICE_ASK = /\b(how much|price|prices|cost|bei|pesa ngapi|ngapi)\b/i;
const COVERAGE_ASK = /\b(wapi|where|mnafika|fika|area|eneo|cover|reach)\b/i;
const NAME_ANSWER =
  /\b(jina lako ni|your name is|najua jina|tayari najua|yes, this is|ndiyo, ni)\b/i;
const NAME_ASK =
  /\b(jina lako|niambie jina|may i have your name|what(?:'s| is) your name|naongea na|ninaongea naye|am i speaking with|speaking with|nipe jina)\b/i;
const COMPLAINT = /\b(complaint|lalamiko|shikilio|manager|meneja)\b/i;

const PLACES = [
  'Ongata Rongai',
  'Kitengela',
  'Syokimau',
  'Kiambu',
  'Westlands',
  'Nairobi',
  'Nakuru',
  'Juja',
];

const CATALOGS = {
  'done and dusted': [
    'couch cleaning',
    'mattress cleaning',
    'carpet cleaning',
    'house cleaning',
    'Airbnb cleaning',
    'pet stain removal',
  ],
  'esga stationery': ['counter books', 'stationery'],
};

const SW_TO_EN = [
  ['samahani, sema tena', 'Sorry, say that again'],
  ['samahani sema tena', 'Sorry, say that again'],
  ['je, naongea na', 'Am I speaking with'],
  ['niambie jina lako ndio niwasiliane na timu', 'May I have your name so I can reach the team'],
  ['niambie jina lako', 'May I have your name'],
  ['jina lako ni', 'Your name is'],
  ['tayari najua jina lako', 'I already know your name'],
  ['ninaongea naye', 'am I speaking with you'],
  ['naongea na', 'am I speaking with'],
  ['tunafika maeneo ya', 'We reach'],
  ['kama upo ndani ya', 'If you are in'],
  ['tutafika kwako', 'we will come to you'],
  ['upo eneo gani', 'which area are you in'],
  ['ungependa tukutembelee wapi', 'where should we come'],
  ['ungependa tukuhudumie na gani', 'which service do you need'],
  ['ungependa tusaidie na gani', 'which service do you need'],
  ['unahitaji gani kati ya hizi', 'which of these do you need'],
  ['unahitaji huduma gani', 'which service do you need'],
  ['sina hiyo kwenye rekodi', "I don't have that on file"],
  ['naweza kuandika kwa timu', 'I can note it for the team'],
  ['naweza kuchukua jina lako', 'I can take your name'],
  ['pole sana', 'I am sorry'],
  ['polisana', 'Sorry'],
  ['pole', 'Sorry'],
  ['nimeelewa', 'I understand'],
  ['naelewa', 'I understand'],
  ['sawa', 'Okay'],
  ['asante', 'Thank you'],
  ['hapana', 'No'],
  ['ndiyo', 'Yes'],
  ['ndio', 'Yes'],
  ['huduma', 'service'],
  ['usafi', 'cleaning'],
  ['eneo', 'area'],
  ['jina', 'name'],
  ['lako', 'your'],
  ['yako', 'your'],
  ['timu', 'the team'],
  ['leo', 'today'],
  ['kesho', 'tomorrow'],
  ['bei', 'price'],
];

const EN_TO_SW = [
  ['sorry, say that again', 'Samahani, sema tena'],
  ['am i speaking with', 'Je, naongea na'],
  ['what do you need done', 'Unahitaji huduma gani'],
  ['how can i help', 'Naweza kusaidia'],
  ['how else can i help', 'Naweza kusaidia vipi'],
  ['i hear you loud and clear', 'Nakusikia vizuri'],
  ['your name is', 'Jina lako ni'],
  ['may i have your name', 'Niambie jina lako'],
];

function catalogFor(fixture) {
  if (Array.isArray(fixture?.servicesCatalog) && fixture.servicesCatalog.length) {
    return fixture.servicesCatalog.map((item) => String(item));
  }
  const name = String(fixture?.businessName || '').trim().toLowerCase();
  return CATALOGS[name] ? CATALOGS[name].slice() : [];
}

function textLanguage(text) {
  return analyzeCallerLanguage(text).language;
}

function compatible(target, text) {
  const lang = textLanguage(text);
  if (!String(text || '').trim()) return false;
  if (lang === 'unknown' || lang === 'mixed') return true;
  if (target === 'sheng' && (lang === 'sw' || lang === 'sheng' || lang === 'mixed')) return true;
  if (target === 'sw' && lang === 'sheng') return true;
  return lang === target;
}

function applyPairs(text, pairs) {
  let raw = String(text || '');
  const ordered = pairs.slice().sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of ordered) {
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    raw = raw.replace(re, to);
  }
  return raw.replace(/\s+/g, ' ').trim();
}

function shiftLanguage(text, target) {
  if (compatible(target, text)) return text;
  const shifted = target === 'en' ? applyPairs(text, SW_TO_EN) : applyPairs(text, EN_TO_SW);
  if (compatible(target, shifted)) return shifted;
  const pack = getLanguagePack(target);
  const places = placesIn(text);
  if (places.length) return pack.coverage(places);
  if (SERVICE_NOUN.test(text)) return pack.services(serviceNouns(text));
  if (COMPLAINT.test(text)) return pack.complaint;
  if (NAME_ANSWER.test(text)) {
    const name = text.match(/\b(Alvin|[A-Z][a-z]{2,})\b/);
    if (name) return pack.nameAnswer(name[1]);
  }
  return pack.understand;
}

function placesIn(text) {
  const raw = String(text || '');
  return PLACES.filter((place) => new RegExp(place.replace(/\s+/g, '\\s*'), 'i').test(raw));
}

function serviceNouns(text) {
  const found = new Set();
  const raw = String(text || '').toLowerCase();
  if (/couch|sofa|stua/.test(raw)) found.add('couch cleaning');
  if (/mattress/.test(raw)) found.add('mattress cleaning');
  if (/carpet/.test(raw)) found.add('carpet cleaning');
  if (/airbnb/.test(raw)) found.add('Airbnb cleaning');
  if (/pet stain/.test(raw)) found.add('pet stain removal');
  if (/fumig/.test(raw)) found.add('fumigation');
  if (/counter book/.test(raw)) found.add('counter books');
  if (/stationery|vitabu|kitabu/.test(raw)) found.add('stationery');
  if (/usafi wa nyumba|house/.test(raw)) found.add('house cleaning');
  if (/ofisi|office/.test(raw)) found.add('office cleaning');
  return [...found];
}

function asksName(sentence) {
  return NAME_ASK.test(sentence) && !NAME_ANSWER.test(sentence);
}

function stripRedundantNameAsk(sentences, state, caller) {
  const name = String(state?.caller?.name || '').trim();
  if (!name || state?.caller?.nameConfirmed !== true) return sentences;
  const specific = SERVICE_ASK.test(caller) || PRICE_ASK.test(caller) || COVERAGE_ASK.test(caller);
  const kept = sentences.filter((sentence) => {
    if (SERVICE_NOUN.test(sentence) || /\d/.test(sentence)) return true;
    if (asksName(sentence)) return false;
    return true;
  });
  if (kept.length) return kept;
  if (specific) return [];
  return sentences;
}

function servicesSentence(fixture, recorded, lang) {
  const fromRecorded = serviceNouns(recorded);
  const items = fromRecorded.length ? fromRecorded : catalogFor(fixture);
  return getLanguagePack(lang).services(items);
}

function priceSentence(recorded, lang) {
  const pack = getLanguagePack(lang);
  const amount = String(recorded || '').match(/\b(?:ksh|kes)?\s?\d[\d,]*(?:\s?\/[-=])?/i);
  if (amount && /\d/.test(amount[0])) return pack.priceKnown(amount[0].trim());
  return pack.priceUnknown;
}

/**
 * @returns {{ reply_language: string, spoken_sentences: string[], intent: string, answered_question: boolean, needs_handoff: boolean }}
 */
function composeDeterministicReply({
  caller = '',
  recorded = '',
  replyLang = 'en',
  state = {},
  fixture = {},
} = {}) {
  const pack = getLanguagePack(replyLang);
  const lang = pack.code;
  const source = String(recorded || '').trim();
  const askedServices = SERVICE_ASK.test(caller);
  const askedPrice = PRICE_ASK.test(caller);
  let sentences = source ? splitSentences(source) : [];
  if (source && !compatible(lang, source)) {
    sentences = splitSentences(shiftLanguage(source, lang));
  }
  const knownName = String(state?.caller?.name || '').trim();
  sentences = sentences.map((sentence) => {
    if (!knownName || !NAME_ANSWER.test(sentence)) return sentence;
    return pack.nameAnswer(knownName);
  });
  sentences = stripRedundantNameAsk(sentences, state, caller).map(finishSentence).filter(Boolean);

  if (askedServices && !SERVICE_NOUN.test(sentences.join(' '))) {
    const lead = finishSentence(servicesSentence(fixture, source, lang));
    sentences = [lead, ...sentences.filter((sentence) => !/^(which|ungependa|unahitaji|what do you need)/i.test(sentence))];
  }
  if (askedPrice && !/\d|bei|price|rekodi|file|note/i.test(sentences.join(' '))) {
    sentences = [finishSentence(priceSentence(source, lang))];
  }
  if (!sentences.length) sentences = [finishSentence(repairLine(lang))];

  const spoken = sentences.filter(Boolean);
  const joined = spoken.join(' ');
  return {
    reply_language: lang,
    spoken_sentences: spoken,
    intent: askedServices ? 'services' : askedPrice ? 'price' : COMPLAINT.test(caller) ? 'handoff' : 'reply',
    answered_question: askedServices ? SERVICE_NOUN.test(joined) : true,
    needs_handoff: COMPLAINT.test(caller) || COMPLAINT.test(source),
  };
}

function forceLocked(draft, replyLang, caller, state, fixture) {
  const locked = getLanguagePack(replyLang).code;
  const again = composeDeterministicReply({
    caller,
    recorded: (draft?.spoken_sentences || []).join(' '),
    replyLang: locked,
    state,
    fixture,
  });
  again.reply_language = locked;
  if (!again.spoken_sentences.length) again.spoken_sentences = [repairLine(locked)];
  return again;
}

function pipelineFirstSentenceMs(draft) {
  const parser = createSpokenSentenceParser();
  const json = JSON.stringify({
    reply_language: draft.reply_language,
    spoken_sentences: draft.spoken_sentences,
    intent: draft.intent,
    answered_question: draft.answered_question,
    needs_handoff: draft.needs_handoff,
  });
  const started = process.hrtime.bigint();
  let first = null;
  const step = 20;
  for (let i = 0; i < json.length; i += step) {
    const tick = parser.push(json.slice(i, i + step));
    if (!first && tick.language && tick.sentences.length) {
      first = process.hrtime.bigint();
      break;
    }
  }
  if (!first) first = process.hrtime.bigint();
  return Number(first - started) / 1e6;
}

/**
 * Run the structured mouth on one recorded turn.
 * Returns the same shape speakModelText uses, plus pipeline timing.
 */
function speakStructuredTurn({
  caller,
  recorded,
  canned,
  replyLang,
  state,
  fixture,
}) {
  const stages = [];
  const source = String(recorded || canned || '').trim();
  let draft = composeDeterministicReply({
    caller,
    recorded: source,
    replyLang,
    state,
    fixture,
  });
  let checked = validateStructuredReply(draft, replyLang);
  if (!checked.ok) {
    const problems = checked.problems;
    draft = forceLocked(draft, replyLang, caller, state, fixture);
    checked = validateStructuredReply(draft, replyLang);
    stages.push({
      stage: 'transform',
      name: 'structured_regen',
      reason: problems.join(',') || 'invalid',
      before: source,
      after: draft.spoken_sentences.join(' '),
      dropped: false,
    });
  }
  const sourceSentences = (
    checked.sentences && checked.sentences.length ? checked.sentences : draft.spoken_sentences
  ).slice();
  const gated = applyNameGate(sourceSentences, state, replyLang);
  stages.push(...gated.stages);
  const modelAnswer = gated.sentences.join(' ') || repairLine(replyLang);
  const normalized = normalizeStructuredSentence(modelAnswer, { language: replyLang });
  const guarded = protectSpokenAnswer(modelAnswer, normalized.text);
  if (guarded.restored) {
    stages.push({
      stage: 'transform',
      name: 'no_silent_drop',
      reason: guarded.reason,
      before: modelAnswer,
      after: guarded.text,
      dropped: false,
    });
  } else if (guarded.text && guarded.text !== modelAnswer) {
    stages.push({
      stage: 'transform',
      name: 'tts_normalize',
      reason: 'normalized',
      before: modelAnswer,
      after: guarded.text,
      dropped: false,
    });
  }
  let spoken = guarded.text || repairLine(replyLang);
  if (!spoken.trim()) spoken = repairLine(replyLang);
  const prepared = normalizeStructuredSentence(spoken, { language: replyLang });
  const finalText = prepared.text || spoken;
  if (finalText !== spoken) {
    stages.push({
      stage: 'transform',
      name: 'tts_normalize',
      reason: 'normalized',
      before: spoken,
      after: finalText,
      dropped: false,
    });
  }
  return {
    spoken: finalText,
    ttsLanguage: prepared.language,
    stages,
    canned: null,
    outputText: modelAnswer || finalText,
    replyLanguage: getLanguagePack(replyLang).code,
    pipelineFirstSentenceMs: pipelineFirstSentenceMs(draft),
    intent: draft.intent,
  };
}

module.exports = {
  catalogFor,
  composeDeterministicReply,
  speakStructuredTurn,
  shiftLanguage,
  SERVICE_ASK,
  pipelineFirstSentenceMs,
};
