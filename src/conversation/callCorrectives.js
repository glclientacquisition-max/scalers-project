// Post-V5 call correctives. Fillers are not facts. Speech stays spaced.
// Live: HD_977d19fa82b6, HD_d783ed7b7692, HD_fffdeed40484.

const { confirmationLanguage } = require('./language');
const { visitBlockSpeech } = require('./visitLocation');

const FILLER_WORDS = new Set([
  'uh',
  'um',
  'hmm',
  'mm',
  'mmm',
  'mmhmm',
  'okay',
  'ok',
  'sawa',
  'poa',
  'then',
  'alright',
  'right',
  'thanks',
  'thank',
  'asante',
]);

const REAL_GLUE_WORDS = new Set([
  'however',
  'whatever',
  'whenever',
  'wherever',
  'whichever',
  'already',
  'always',
  'alright',
  'altogether',
  'somehow',
  'someone',
  'something',
  'somewhere',
  'sometime',
  'sometimes',
  'anything',
  'anyone',
  'anywhere',
  'nothing',
  'nobody',
  'nowhere',
]);

const NOT_A_NAME = new Set([
  'calling',
  'callings',
  'caller',
  'someone',
  'there',
  'me',
  'shy',
  'lucy',
]);

function normalizeAckText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[?.!,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeLeaveIt(text) {
  const t = normalizeAckText(text).replace(/\bthebook\b/g, 'the book');
  if (!t) return false;
  return /\b(?:just\s+)?leave\s+(?:it|the book|that)\b/.test(t);
}

/**
 * Then / Okay / Sawa alone. Not a quantity, a clock time, or consent to save.
 * A turn that also names a day, item, or number is a real answer.
 */
function looksLikeNonConsentAck(text) {
  if (looksLikeLeaveIt(text)) return true;
  const t = normalizeAckText(text);
  if (!t) return false;
  if (/\d/.test(t)) return false;
  if (
    /\b(tomorrow|today|tonight|kesho|leo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|diary|diaries|carpet|couch|sofa|mattress|runda|rongai|rangga|name|jina)\b/.test(
      t
    )
  ) {
    return false;
  }
  const words = t.split(' ').filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return words.every((word) => FILLER_WORDS.has(word));
}

/**
 * Okay or Sawa is consent only as the direct answer to an explicit confirm
 * ask ("I have not saved that. Should I continue?"). Anywhere else it is a
 * filler. Leave it is never consent.
 * @param {string[]} questionsAsked  slots asked before this caller turn
 */
function ackIsConsent(questionsAsked, text) {
  const lastAsk = (Array.isArray(questionsAsked) ? questionsAsked : []).slice(-1)[0];
  return lastAsk === 'confirm' && looksLikeNonConsentAck(text) && !looksLikeLeaveIt(text);
}

function looksLikeUrgentContact(text) {
  const t = normalizeAckText(text);
  if (!t) return false;
  if (/\b(carpet|couch|sofa|mattress|clean|cleaning|diary|diaries|order)\b/.test(t)) {
    return false;
  }
  return (
    /\bcontact\b.{0,24}\burgent(?:ly)?\b/.test(t) ||
    /\burgent(?:ly)?\b.{0,24}\bcontact\b/.test(t) ||
    /\b(?:it is|its|this is) urgent\b/.test(t) ||
    /\b(?:ni|iko) (?:haraka|dharura)\b/.test(t)
  );
}

function hasConcreteUrgentNeed(text) {
  if (looksLikeNameIntroductionOnly(text) || looksLikeNonConsentAck(text)) return false;
  const t = normalizeAckText(text)
    .replace(
      /\b(contact|urgent|urgently|please|me|now|right|away|the|a|an|team|call|back|asap|soon|someone|somebody|need|to|it|is|this|very|really|kindly|haraka|dharura|tafadhali)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 4;
}

function looksLikeNameIntroductionOnly(text) {
  const t = normalizeAckText(text);
  const match =
    /^(?:this is|my name is|i am|im|naitwa|ninaitwa|jina langu ni)\s+([a-z][a-z'-]{1,20})$/.exec(
      t
    );
  if (!match) return false;
  return !NOT_A_NAME.has(match[1]);
}

function looksLikeVagueSmallTalk(text) {
  const t = normalizeAckText(text);
  if (!t) return false;
  return /^(?:whats up(?: for me)?|what is up(?: for me)?|nothing much(?: im just asking)?|im just asking|just asking)$/.test(
    t
  );
}

function slotValue(state, key) {
  const raw = state?.entities?.[key];
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return String(raw.value || '').trim();
  }
  return String(raw || '').trim();
}

function jobInProgress(state) {
  const intent = String(state?.intent || '');
  return [
    'order',
    'hold',
    'booking',
    'human',
    'cancellation',
    'price',
    'availability',
    'product_inquiry',
  ].includes(intent);
}

function helpLine(lang) {
  return lang === 'sw' || lang === 'sheng' ? 'Naweza kusaidia vipi?' : 'How can I help?';
}

function quantityLine(state, lang) {
  const item =
    slotValue(state, 'product') ||
    slotValue(state, 'requestedItem') ||
    slotValue(state, 'service');
  if (lang === 'sw' || lang === 'sheng') {
    return item ? `${item}. Ngapi?` : 'Unataka ngapi?';
  }
  return item ? `${item}. How many?` : 'How many would you like?';
}

function missingSlotLine(slot, lang) {
  const sw = lang === 'sw' || lang === 'sheng';
  if (slot === 'name') return sw ? 'Jina lako nani?' : 'What is your name?';
  if (slot === 'reason') return sw ? 'Unahitaji nini?' : 'What do you need help with?';
  if (slot === 'when' || slot === 'when_text' || slot === 'when_or_reference') {
    return sw ? 'Siku na saa gani?' : 'What day and time works?';
  }
  if (slot === 'time') return sw ? 'Saa ngapi siku hiyo?' : 'What time that day?';
  if (slot === 'location' || slot === 'landmark') {
    return sw ? 'Tuje wapi?' : 'Where should we come?';
  }
  if (slot === 'area') return sw ? 'Hiyo ni eneo gani?' : 'Which area is that in?';
  if (slot === 'quantity') return quantityLine({}, lang);
  if (slot === 'service' || slot === 'subject' || slot === 'catalog_item') {
    return sw ? 'Unahitaji huduma gani?' : 'What do you need done?';
  }
  if (slot === 'confirm') {
    return sw
      ? 'Bado sijahifadhi. Niendelee?'
      : 'I have not saved that. Should I continue?';
  }
  return helpLine(lang);
}

/**
 * Local line when Gemini must not invent a fact. Empty means let the model run.
 * @param {{ text?: string, state?: object, language?: string }} [opts]
 * @returns {string}
 */
function pickCorrectiveReply(opts = {}) {
  const text = String(opts.text || '');
  const state = opts.state || {};
  const lang = confirmationLanguage(opts.language || state.language?.current);
  const intent = String(state.intent || '');
  const name = String(state.caller?.name || '').trim() || slotValue(state, 'name');
  const missing = Array.isArray(state.goal?.missingSlots) ? state.goal.missingSlots : [];
  const blocked = String(state.visitPlace?.blocked || '');

  if (looksLikeLeaveIt(text)) {
    if (blocked === 'outside' || blocked === 'unknown_coverage') {
      return visitBlockSpeech(blocked, lang);
    }
    if (intent === 'booking') {
      return lang === 'sw' || lang === 'sheng'
        ? 'Bado sijahifadhi ziara. Niombee?'
        : 'I have not saved a visit. Should I request it?';
    }
  }

  if (looksLikeUrgentContact(text)) {
    if (!name || missing.includes('name')) return missingSlotLine('name', lang);
    if (!hasConcreteUrgentNeed(text)) return missingSlotLine('reason', lang);
  } else if (
    intent === 'human' &&
    missing.includes('reason') &&
    !hasConcreteUrgentNeed(text)
  ) {
    if (!name || missing.includes('name')) return missingSlotLine('name', lang);
    return missingSlotLine('reason', lang);
  }

  if (looksLikeNonConsentAck(text) && !state.conversation?.consentAck) {
    const quantity = slotValue(state, 'quantity');
    if ((intent === 'order' || intent === 'hold') && !quantity) {
      return quantityLine(state, lang);
    }
    const next = missing.find((slot) => slot !== 'name' || !name) || missing[0];
    if (next) return missingSlotLine(next, lang);
    if (intent === 'order' || intent === 'hold' || intent === 'booking') {
      return missingSlotLine('confirm', lang);
    }
    if (!jobInProgress(state)) return helpLine(lang);
  }

  const openVisit =
    state.returning?.fileRole === 'primary' &&
    state.returning?.identityBound &&
    state.returning?.nextVisit;
  if (!jobInProgress(state) && !openVisit && looksLikeNameIntroductionOnly(text)) {
    return helpLine(lang);
  }
  if (!jobInProgress(state) && !openVisit && looksLikeVagueSmallTalk(text)) {
    return helpLine(lang);
  }
  return '';
}

function spaceSpokenWords(text) {
  let t = String(text || '');
  if (!t) return '';
  t = t.replace(/\bUkipatakitu\b/g, 'Ukipata kitu');
  t = t.replace(/\bNatakapembamba\b/g, 'Nataka pembamba');
  t = t.replace(/\b(I|We|They)(can|am|have|will)\b/g, '$1 $2');
  t = t.replace(/\b(can)(have)\b/gi, '$1 $2');
  t = t.replace(/\b(understand)(it)\b/gi, '$1 $2');
  t = t.replace(/\b(How|What|When|Where|Which|Got|All)([a-z]{2,})\b/g, (full, head, rest) => {
    if (REAL_GLUE_WORDS.has(`${head}${rest}`.toLowerCase())) return full;
    return `${head} ${rest}`;
  });
  t = t.replace(/,(\S)/g, ', $1');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Model closes that claim a count or a visit the tool did not save.
 * @param {string} text
 */
function stripUnsavedCloses(text) {
  let t = String(text || '');
  if (!t.trim()) return '';
  const before = t;
  t = t.replace(/\b(?:we )?look forward to serving you\b[^.!?]*[.!?]?/gi, ' ');
  t = t.replace(/\bgot it,?\s+\d+\b[^.!?]*[.!?]?/gi, ' ');
  t = t.replace(/\bi will submit this (?:request|order)\b[^.!?]*[.!?]?/gi, ' ');
  if (t !== before) {
    t = t.replace(/\bhave a (?:great|good|nice) day\b[.!?]?/gi, ' ');
    t = t.replace(/\bthank you for choosing\b[^.!?]*[.!?]?/gi, ' ');
    t = t.replace(/\ball noted\b[,.]?/gi, ' ');
  } else if (
    /\ball noted\b/i.test(t) &&
    /\b(thank you for choosing|serving you|have a (?:great|good) day)\b/i.test(t)
  ) {
    return '';
  }
  return t.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

function prepareStreamedSpeech(text) {
  return stripUnsavedCloses(spaceSpokenWords(text));
}

module.exports = {
  ackIsConsent,
  looksLikeLeaveIt,
  looksLikeNonConsentAck,
  looksLikeUrgentContact,
  hasConcreteUrgentNeed,
  looksLikeNameIntroductionOnly,
  looksLikeVagueSmallTalk,
  pickCorrectiveReply,
  spaceSpokenWords,
  stripUnsavedCloses,
  prepareStreamedSpeech,
};
