// Deterministic entity extraction grounded in the active tenant profile.

const { normalizeProducts } = require('./productCatalog');
const { normalizeServices } = require('./liveKnowledge');
const { normalizeLocations } = require('./businessLocations');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+\s:'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function entity(value, source, confidence = 0.9, confirmed = true) {
  return {
    value: String(value || '').trim(),
    source,
    confidence,
    confirmed,
  };
}

function phraseAppears(text, phrase) {
  const haystack = ` ${normalizeText(text)} `;
  const needle = normalizeText(phrase);
  return Boolean(needle && haystack.includes(` ${needle} `));
}

function findCatalogMatch(text, profile = {}) {
  const products = normalizeProducts(profile.productCatalog);
  const candidates = [];
  for (const product of products) {
    candidates.push({
      kind: 'product',
      canonical: product.name,
      terms: [product.name, product.sku, ...product.aliases].filter(Boolean),
    });
  }
  for (const service of normalizeServices(profile.servicesCatalog)) {
    candidates.push({
      kind: 'service',
      canonical: service.name,
      terms: [service.name].filter(Boolean),
    });
  }

  let best = null;
  for (const candidate of candidates) {
    for (const term of candidate.terms) {
      if (!phraseAppears(text, term)) continue;
      const score = normalizeText(term).length;
      if (!best || score > best.score) {
        best = { ...candidate, matched: term, score };
      }
    }
  }
  return best;
}

function extractName(text) {
  const match =
    /(?:\bmy name is\b|\bi am called\b|\bi'm called\b|\bnaitwa\b|\bjina langu ni\b)\s+([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})/iu.exec(
      String(text || '')
    );
  if (!match) return null;
  const value = match[1]
    .replace(/\s+(?:and|na|calling|looking|nataka)\b.*$/i, '')
    .trim();
  return isPlausibleCallerName(value) ? value : null;
}

const NAME_AFFIRMATION =
  /^(yes|yeah|yep|yup|ndiyo|ndio|sawa|okay|ok|sure|right|alright|poa|eeh|ehe|ee|correct|that'?s right|that is right|ni hivyo|ndivyo)(?:\s+(?:please|thanks|asante))?$/i;

const NAME_NEGATION =
  /(?:^|[^\p{L}])(no|nope|nah|hapana|siyo)(?:$|[^\p{L}])/iu;

function isNameAffirmation(text) {
  const lower = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/g, '')
    .trim();
  return Boolean(lower) && NAME_AFFIRMATION.test(lower);
}

function isNameNegation(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (NAME_NEGATION.test(value)) return true;
  return /\b(wrong name|not my name|sio hiyo|si hivyo|si jina)\b/i.test(value);
}

function extractCorrectedName(text) {
  const explicit = extractName(text);
  if (explicit) return explicit;
  const match =
    /(?:\b(?:no|nope|nah|hapana|siyo)\b)\s*[,:]?\s*(?:it'?s\s+|ni\s+|jina(?:\s+langu)?\s+ni\s+)?([\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})/iu.exec(
      String(text || '')
    );
  if (!match) return null;
  const value = match[1]
    .replace(/\s+(?:and|na|calling|looking|nataka)\b.*$/i, '')
    .trim();
  if (/^(not|that|this|it|ni|the|my|jina)$/i.test(value)) return null;
  return isPlausibleCallerName(value) ? value : null;
}

/**
 * One-time name confirm/correct after first capture.
 * First extract stays unconfirmed. Next caller turn: negation+new name
 * overwrites; yes/continue confirms; later extracts may update without re-asking.
 */
function applyCallerNameConfirmation(previous = {}, text = '', incomingEntities = {}) {
  const entities = { ...(incomingEntities || {}) };
  const prevName =
    String(previous?.caller?.name || '').trim() ||
    entityValue(previous?.entities?.name);
  const prevConfirmed = previous?.caller?.nameConfirmed === true;
  const extracted = entityValue(entities.name);

  function stamp(name, source, confirmed, confidence = 0.95) {
    if (!name) return entities;
    entities.name = entity(name, source, confidence, confirmed);
    return entities;
  }

  if (prevConfirmed) {
    if (extracted && extracted !== prevName) {
      stamp(extracted, entities.name?.source || 'caller_explicit', true);
      return { name: extracted, nameConfirmed: true, entities };
    }
    if (prevName) stamp(prevName, previous?.entities?.name?.source || 'caller_explicit', true);
    return { name: prevName || extracted || null, nameConfirmed: true, entities };
  }

  if (!prevName && extracted) {
    stamp(extracted, entities.name?.source || 'caller_explicit', false, entities.name?.confidence || 0.9);
    return { name: extracted, nameConfirmed: false, entities };
  }

  if (prevName) {
    const corrected = isNameNegation(text) ? extractCorrectedName(text) : null;
    if (corrected) {
      stamp(corrected, 'caller_correction', true, 0.98);
      return { name: corrected, nameConfirmed: true, entities };
    }
    if (isNameNegation(text)) {
      stamp(prevName, previous?.entities?.name?.source || 'caller_explicit', false);
      return { name: prevName, nameConfirmed: false, entities };
    }
    if (extracted && extracted !== prevName) {
      stamp(extracted, entities.name?.source || 'caller_explicit', true);
      return { name: extracted, nameConfirmed: true, entities };
    }
    stamp(prevName, previous?.entities?.name?.source || 'caller_explicit', true);
    return { name: prevName, nameConfirmed: true, entities };
  }

  return { name: extracted || null, nameConfirmed: false, entities };
}

const NAME_BLOCKLIST = new Set([
  'yes',
  'no',
  'okay',
  'ok',
  'sawa',
  'ndiyo',
  'hapana',
  'uh',
  'uhhuh',
  'uh-huh',
  'mm',
  'mmm',
  'hmm',
  'hm',
  'hello',
  'hi',
  'hey',
  'please',
  'thanks',
  'thank',
  'callings',
  'calling',
  'manager',
  'someone',
  'human',
  'pardon',
  'sorry',
  'what',
  'huh',
  'eh',
  'nini',
  'repeat',
]);

/**
 * Caller did not hear the last question. Not a name, slot fill, or misunderstanding.
 * Live miss: HD_a922d3f8ab52 treated "Pardon?" as completing the booking.
 */
function isHearAgainSignal(text) {
  const lower = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[?.!,]+$/g, '')
    .trim();
  if (!lower) return false;
  return /^(pardon( me)?|i beg your pardon|sorry|what|huh|eh|come again|say( that)? again|repeat( that)?|nini|sema tena|unasemaje|sikusikia|i (didn't|did not) (hear|catch)( that)?|what (was that|did you say)|could you (repeat|say that again)|can you repeat( that)?)$/i.test(
    lower
  );
}

function isBackchannelOrFragment(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (isHearAgainSignal(value)) return true;
  const lower = value.toLowerCase().replace(/[?.!,]+$/g, '').trim();
  const compact = lower.replace(/[\s'-]+/g, '');
  if (
    /^(yes|no|yeah|yep|nah|okay|ok|sawa|ndiyo|hapana|uh|uhhuh|mm+|hmm+|hello|hi|hey|thanks|thank you|asante|poa|sure|right|alright|continue|go on)$/i.test(
      lower
    )
  ) {
    return true;
  }
  if (NAME_BLOCKLIST.has(compact) || NAME_BLOCKLIST.has(lower)) return true;
  // Cut-off STT fragments without a complete thought.
  if (/[—–]\s*$/.test(value) || /…\s*$/.test(value)) return true;
  if (
    /^(i('d| would)? like to|i want to|i need to|i have to)\b/i.test(lower) &&
    lower.split(/\s+/).length <= 6
  ) {
    return true;
  }
  return false;
}

function isPlausibleCallerName(value) {
  const name = String(value || '').trim();
  if (!name || name.length < 2 || name.length > 40) return false;
  if (isHearAgainSignal(name) || isBackchannelOrFragment(name)) return false;
  const lower = name.toLowerCase();
  if (
    /\b(i('d| would)? like to|i want to|i need to|i have to|discuss|talk about|speak to|tell me|can you|could you)\b/i.test(
      lower
    )
  ) {
    return false;
  }
  const words = name.split(/\s+/);
  if (words.length > 3) return false;
  if (/\d/.test(name)) return false;
  if (!/^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2}$/u.test(name)) {
    return false;
  }
  return true;
}

function extractPhone(text) {
  const match = /(?:\+?254|0)\s*\d(?:[\s-]*\d){8}\b/.exec(String(text || ''));
  return match ? match[0].replace(/[\s-]/g, '') : null;
}

function extractLandmark(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const labeled =
    /\b(?:landmark|address)\s+(?:is|ni|:)\s+([^,.!?]+)/i.exec(raw);
  if (labeled) {
    const value = labeled[1].replace(/\s+(?:and|na)\b.*$/i, '').trim();
    if (value && !extractWhen(value) && !/^\d/.test(value)) {
      return value.slice(0, 80);
    }
  }
  const near =
    /\b(?:near|opposite|next to|karibu(?:\s+na)?)\s+([^,.!?]+)/i.exec(raw);
  if (near) {
    const value = near[1].trim();
    if (value && !extractWhen(value) && !/^\d/.test(value)) {
      return value.slice(0, 80);
    }
  }
  return null;
}

function extractWhen(text) {
  const raw = String(text || '');
  const relative =
    /\b(today|tomorrow|tonight|this (?:morning|afternoon|evening)|next (?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|leo|kesho|jioni|asubuhi)\b/i.exec(
      raw
    );
  const clock =
    /\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.exec(raw) ||
    /\bsaa\s+(?:moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi|\d{1,2})(?:\s+(?:asubuhi|mchana|jioni|usiku))?\b/i.exec(
      raw
    );
  return [relative?.[0], clock?.[0]].filter(Boolean).join(' ').trim() || null;
}

function extractQuantity(text, intent) {
  if (!['hold', 'order', 'booking'].includes(intent)) return null;
  const raw = String(text || '');
  const digit = /\b(\d{1,3})\b/.exec(raw);
  if (digit && !/\b(?:at|saa)\s*$/.test(raw.slice(0, digit.index).toLowerCase())) {
    return digit[1];
  }
  const words = {
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    moja: '1',
    mbili: '2',
    tatu: '3',
    nne: '4',
    tano: '5',
  };
  const word = new RegExp(`\\b(${Object.keys(words).join('|')})\\b`, 'i').exec(raw);
  return word ? words[word[1].toLowerCase()] : null;
}

function extractBudget(text) {
  const match =
    /\b(?:budget(?: is| ya)?|under|below|up to|hadi)\s*(?:ksh|kes|shillings?|bob)?\s*([\d,]+(?:\s*(?:k|thousand))?)\b/i.exec(
      String(text || '')
    );
  return match ? match[1].trim() : null;
}

function extractPolicyKey(text) {
  const value = normalizeText(text);
  const keys = ['returns', 'refund', 'exchange', 'delivery', 'payment', 'deposit', 'cancellation', 'warranty'];
  return keys.find((key) => value.includes(key)) || null;
}

function extractBranch(text, profile = {}) {
  for (const location of normalizeLocations(profile.businessLocations)) {
    const terms = [location.label, location.address, location.landmark].filter(Boolean);
    if (terms.some((term) => phraseAppears(text, term))) {
      return location.label || location.address || location.landmark;
    }
  }
  return null;
}

function shortSlotAnswer(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 100) return null;
  const words = value.split(/\s+/);
  if (words.length > 6) return null;
  if (isBackchannelOrFragment(value)) return null;
  return value.replace(/[?.!,]+$/g, '').trim() || null;
}

function extractConversationEntities(
  text,
  { profile = {}, intent = 'unknown', state = null } = {}
) {
  const entities = {};
  const catalog = findCatalogMatch(text, profile);
  if (catalog) {
    entities[catalog.kind] = entity(
      catalog.canonical,
      `tenant_${catalog.kind}_catalog`,
      1,
      true
    );
  }

  const name = extractName(text);
  if (name) entities.name = entity(name, 'caller_explicit', 0.95, false);
  const phone = extractPhone(text);
  if (phone) entities.phone = entity(phone, 'caller_explicit', 0.98, true);
  const when = extractWhen(text);
  if (when) entities.when = entity(when, 'caller_explicit', 0.9, false);
  const quantity = extractQuantity(text, intent);
  if (quantity) entities.quantity = entity(quantity, 'caller_explicit', 0.9, false);
  const budget = extractBudget(text);
  if (budget) entities.budget = entity(budget, 'caller_explicit', 0.85, false);
  const policyKey = extractPolicyKey(text);
  if (policyKey) entities.policyKey = entity(policyKey, 'caller_explicit', 0.95, true);
  const branch = extractBranch(text, profile);
  if (branch) entities.branch = entity(branch, 'tenant_location_match', 1, true);
  const landmark = extractLandmark(text);
  if (landmark) entities.landmark = entity(landmark, 'caller_explicit', 0.9, false);

  const firstMissing = state?.goal?.missingSlots?.[0];
  const shortAnswer = shortSlotAnswer(text);
  if (
    !entities.name &&
    firstMissing === 'name' &&
    shortAnswer &&
    isPlausibleCallerName(shortAnswer)
  ) {
    entities.name = entity(shortAnswer, 'contextual_slot_answer', 0.8, false);
  }
  if (
    !entities.product &&
    !entities.service &&
    firstMissing === 'subject' &&
    shortAnswer
  ) {
    entities.requestedItem = entity(
      shortAnswer,
      'caller_requested_unverified',
      0.75,
      false
    );
  }
  if (!entities.when && firstMissing === 'when' && shortAnswer) {
    entities.when = entity(shortAnswer, 'contextual_slot_answer', 0.75, false);
  }
  if (
    !entities.landmark &&
    firstMissing === 'landmark' &&
    shortAnswer &&
    !extractWhen(shortAnswer)
  ) {
    entities.landmark = entity(shortAnswer, 'contextual_slot_answer', 0.75, false);
  }

  return entities;
}

function entityValue(raw) {
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return String(raw.value || '').trim();
  }
  return String(raw || '').trim();
}

module.exports = {
  normalizeText,
  entity,
  findCatalogMatch,
  extractName,
  extractCorrectedName,
  isNameAffirmation,
  isNameNegation,
  applyCallerNameConfirmation,
  extractPhone,
  extractWhen,
  extractLandmark,
  extractQuantity,
  extractBudget,
  extractPolicyKey,
  extractBranch,
  extractConversationEntities,
  shortSlotAnswer,
  isHearAgainSignal,
  isBackchannelOrFragment,
  isPlausibleCallerName,
  entityValue,
};
