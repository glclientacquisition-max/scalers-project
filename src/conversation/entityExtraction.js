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
  return value.length >= 2 ? value : null;
}

function extractPhone(text) {
  const match = /(?:\+?254|0)\s*\d(?:[\s-]*\d){8}\b/.exec(String(text || ''));
  return match ? match[0].replace(/[\s-]/g, '') : null;
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
  if (/^(yes|no|okay|ok|sawa|ndiyo|hapana)$/i.test(value)) return null;
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
  if (name) entities.name = entity(name, 'caller_explicit', 0.95, true);
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

  const firstMissing = state?.goal?.missingSlots?.[0];
  const shortAnswer = shortSlotAnswer(text);
  if (!entities.name && firstMissing === 'name' && shortAnswer) {
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
  extractPhone,
  extractWhen,
  extractQuantity,
  extractBudget,
  extractPolicyKey,
  extractBranch,
  extractConversationEntities,
  shortSlotAnswer,
  entityValue,
};
