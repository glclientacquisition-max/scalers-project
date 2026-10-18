// BRAIN_CALL_FIXES_D199 (18 Oct owner review, Desk REVIEW-2026-10-18):
// what the call was about, in words the owner can read, never the caller's
// raw words. Callers gate every use on callFixesD199Enabled(); this module
// only computes.
//
// Contract (docs/explanation/brain/CALLER_IDENTITY_AND_SUMMARY.md, summary.topic):
//   1. a saved row (visit service, then hold/order/enquiry item that is not garbled)
//   2. a catalogue name the caller said
//   3. a label for the call's intent ("your opening hours", "speaking to Chris")
//   4. null: nothing readable. Desk then shows no topic; it never falls back to caller words.

function clean(value, max = 200) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words that say what kind of thing a catalogue row is, not which one.
const GENERIC = new Set([
  'and', 'the', 'of', 'for', 'per', 'with', 'up', 'to', 'add', 'on', 'in', 'a', 'an',
  'clean', 'cleaning', 'cleans', 'service', 'services', 'standard', 'package', 'general',
  'inquiries', 'inquiry', 'enquiries', 'enquiry', 'materials', 'printing', 'stationery',
  'stationeries', 'internal', 'sq', 'ft', 'seat', 'room', 'contract', 'small', 'medium', 'large',
]);

// Swahili caller words for catalogue nouns (EN catalogue names).
const SYNONYMS = {
  zulia: 'carpet', mazulia: 'carpet', godoro: 'mattress', magodoro: 'mattress',
  kochi: 'sofa', makochi: 'sofa', dirisha: 'window', madirisha: 'window',
  friji: 'refrigerator', jiko: 'oven', ofisi: 'office', nyumba: 'house',
};

function stem(word) {
  const w = SYNONYMS[word] || word;
  return w.length > 4 ? w.replace(/(?:es|s)$/, '') : w;
}

function words(value) {
  return norm(value).split(' ').filter(Boolean).map(stem);
}

/** Catalogue name for the owner: no "(per room)", sentence case. */
function topicName(name) {
  const base = clean(String(name || '').replace(/\([^)]*\)/g, ' '), 80).replace(/[\s,;:-]+$/, '');
  return base
    .split(' ')
    .map((w) => (/[A-Z]{2,}|\d/.test(w) ? w : w.toLowerCase()))
    .join(' ');
}

function distinctive(name) {
  const raw = norm(String(name || '').replace(/\([^)]*\)/g, ' ')).split(' ');
  return [...new Set(raw.filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w)).map(stem))].filter(
    (w) => !GENERIC.has(w)
  );
}

/** Service and product names from a tenant profile (topic lookups only). */
function catalogueTopicNames(profile = {}) {
  const out = [];
  for (const list of [profile.servicesCatalog, profile.productCatalog]) {
    for (const row of Array.isArray(list) ? list : []) {
      const name = clean(typeof row === 'string' ? row : row?.name || row?.title, 120);
      if (name && !out.includes(name)) out.push(name);
      if (out.length >= 120) return out;
    }
  }
  return out;
}

/** Catalogue names whose every distinctive word the caller said. */
function catalogueHits(text, names = []) {
  const said = new Set(words(text));
  if (!said.size) return [];
  const hits = [];
  for (const name of names) {
    const need = distinctive(name);
    if (need.length && need.every((w) => said.has(w))) hits.push(name);
  }
  return hits;
}

/** Team directory people: [{ name, role }]. */
function teamPeople(profile = {}) {
  const rows = Array.isArray(profile.teamDirectory) ? profile.teamDirectory : [];
  return rows
    .map((row) => ({ name: clean(row?.name, 80), role: clean(row?.role, 60) }))
    .filter((row) => row.name);
}

// Matched on norm() text (no punctuation, no apostrophes).
const PERSON_LEAD =
  /^(?:(?:hello|hallo|halo|hi|hey|habari|sasa|niaje|uh+|um+|eh+|yes|ndio|ok|okay|sawa)\s+)*(?:(?:i(?:d| would)? (?:like|want|need) to (?:talk|speak) (?:to|with)|can i (?:talk|speak) (?:to|with)|may i (?:talk|speak) (?:to|with)|is|nataka kuongea na|naomba kuongea na|naomba|nipe|niunganishe na|niweke kwa|nimpate)\s+)?/;
const PERSON_TAIL = /\s+(?:there|please|tafadhali|yupo|ako|iko|around|in)$/;
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'madam', 'madame', 'mister', 'sir', 'dr', 'mama', 'baba', 'mzee']);

/** The turn is only a team member's name ("Chris.", "Is Chris there?"). */
function teamPersonNamed(text, people = []) {
  if (!people.length) return null;
  const said = norm(text).replace(PERSON_LEAD, '').replace(PERSON_TAIL, '').trim();
  if (!said || said.split(' ').length > 3) return null;
  for (const person of people) {
    const full = norm(person.name);
    const tokens = full.split(' ').filter((w) => w.length >= 3 && !TITLES.has(w));
    const bare = said.split(' ').filter((w) => !TITLES.has(w)).join(' ');
    if (said === full || (bare && (bare === tokens.join(' ') || tokens.includes(bare)))) {
      return { name: person.name, role: person.role || '' };
    }
  }
  return null;
}

function personLabel(person) {
  if (!person?.name) return '';
  return person.role ? `${person.name} (${person.role})` : person.name;
}

// "From began yellow", "Because it's a really long": STT pieces, not items.
const GARBLED_LEAD =
  /^(?:from|because|cause|coz|which|what|have|has|had|did|do|does|i|im|i'm|we|were|we're|you|it|its|it's|is|are|was|and|but|so|then|also|like|um+|uh+|yes|no|okay|ok|sawa|na|kwa|ama|halafu|ile|hiyo)\b/i;

function isGarbledItem(item, names = []) {
  const value = clean(item, 200);
  if (!value) return false;
  if (!/\p{L}/u.test(value)) return true;
  if (!GARBLED_LEAD.test(value.replace(/[’]/g, "'"))) return false;
  return catalogueHits(value, names).length === 0;
}

/** "Cartons 10 JK copy paper, pens za Damasa 20, ..." is a list, not an item. */
function isItemList(item) {
  const value = String(item || '');
  const commas = (value.match(/,/g) || []).length;
  return commas >= 2 || (commas >= 1 && /\d/.test(value));
}

const COUNT_WORDS =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|dozen|half|a pair|moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi|ishirini|thelathini|arobaini|hamsini|mia|elfu|dazeni)\b/i;

/** A count ("3 boxes", "dozen") or ''. "Mbalimbali", "various", "many" are not counts. */
function countQuantity(quantity) {
  const value = clean(quantity, 80);
  if (!value) return '';
  if (/\d/.test(value) || COUNT_WORDS.test(value)) return value;
  return '';
}

const LIST_UNIT =
  /\b(?:cartons?|boxes|box|packets?|packs?|pcs|pieces?|reams?|dozens?|dz|bundles?|rolls?|units?|za|ya|of|kama|na|and)\b/gi;

/** "JK copy paper and more" from a list; the item itself otherwise. */
function itemTopic(item) {
  const value = clean(item, 200);
  if (!value) return '';
  if (!isItemList(value)) return value.replace(/[.]+$/, '');
  const first = value.split(/,|\bna\b|\band\b/i)[0] || '';
  const named = clean(first.replace(/\d+/g, ' ').replace(LIST_UNIT, ' '), 80);
  return named ? `${named} and more` : 'an order list';
}

// Service words (the same set callerAskSpecificity scores highest), named
// for the owner. Only the word is used, never the sentence around it.
const SERVICE_WORDS = [
  [/\bdishwash\w*/i, 'dishwashing'],
  [/\bcarpets?\b|\bmazulia\b|\bzulia\b/i, 'carpet cleaning'],
  [/\bsofas?\b|\bcouch\w*|\bkochi\b|\bmakochi\b/i, 'sofa cleaning'],
  [/\bmattress\w*|\bgodoro\b|\bmagodoro\b/i, 'mattress cleaning'],
  [/\bupholster\w*/i, 'upholstery cleaning'],
  [/\bfumigat\w*/i, 'fumigation'],
  [/\bplumb\w*/i, 'plumbing'],
  [/\belectric\w*/i, 'electrical work'],
];

function serviceWordTopic(text) {
  const value = String(text || '');
  if (!value) return '';
  for (const [re, label] of SERVICE_WORDS) if (re.test(value)) return label;
  return '';
}

const INTENT_TOPIC = {
  hours_open: 'your opening hours',
  hours: 'your opening hours',
  directions: 'directions to the shop',
  location: 'directions to the shop',
  price: 'prices',
  price_band: 'prices',
  availability: 'what is in stock',
  book_visit: 'booking a visit',
  booking: 'booking a visit',
  reschedule: 'moving a visit',
  cancel: 'cancelling a visit',
  order_enquiry: 'placing an order',
  hold_or_pickup: 'holding an item for pickup',
  service_area: 'the areas you serve',
  policy: 'your policies',
  complaint: 'a complaint',
  emergency: 'an emergency',
};

function intentTopic(intent, { person = null } = {}) {
  const key = String(intent || '').toLowerCase();
  if (key === 'human' && person?.name) return `speaking to ${person.name}`;
  return INTENT_TOPIC[key] || '';
}

function okRow(row, actions) {
  return (
    row &&
    actions.includes(row.action) &&
    (row.status === 'succeeded' || row.status === 'updated')
  );
}

/**
 * summary.topic: what the call was about, or null.
 * @param {{ results?: object[], hits?: string[], intent?: string, person?: object|null, names?: string[], cues?: string[], goal?: string }} opts
 * @returns {{ topic: string|null, source: 'saved_row'|'catalogue'|'intent'|null }}
 */
function summaryTopic({ results = [], hits = [], intent = '', person = null, names = [], cues = [], goal = '' } = {}) {
  const rows = Array.isArray(results) ? results : [];
  const visit = [...rows].reverse().find((row) => okRow(row, ['create_appointment', 'update_appointment']));
  const service = clean(
    visit?.value?.serviceName || visit?.value?.service || visit?.record?.service_name || '',
    120
  );
  if (service) return { topic: topicName(service), source: 'saved_row' };
  // Newest saved request whose item reads (a garbled later row does not hide an earlier one).
  for (const row of [...rows].reverse()) {
    if (!okRow(row, ['create_service_request'])) continue;
    const item = clean(row?.value?.item || row?.record?.item || '', 200);
    if (item && !isGarbledItem(item, names) && !/^item not captured$/i.test(item)) {
      return { topic: lowerLead(itemTopic(item)), source: 'saved_row' };
    }
  }
  const hit = (Array.isArray(hits) ? hits : []).filter(Boolean).slice(-1)[0];
  if (hit) return { topic: topicName(hit), source: 'catalogue' };
  const word = serviceWordTopic(goal);
  if (word) return { topic: word, source: 'catalogue' };
  const label = intentTopic(intent, { person }) || cueTopic(cues);
  if (label) return { topic: label, source: 'intent' };
  return { topic: null, source: null };
}

/** "Long list of ..." -> "long list of ..."; "JK copy paper" stays. */
function lowerLead(text) {
  const value = String(text || '');
  return /^[A-Z][a-z]/.test(value) ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

const PAST_REQUEST =
  /\b(?:my|our|the|a|previous|last|earlier|old)\s+(?:previous\W+\s*)?(?:previous|last|earlier)?\s*(booking|visit|appointment|order|request)\b|\b(booking|order|ombi) (?:ya|la) (?:awali|zamani|jana)\b/i;

/** Caller-turn cues the intent alone misses (kept on brain state). */
function turnCues(text) {
  const value = String(text || '');
  const cues = [];
  const past = value.match(PAST_REQUEST);
  if (past && /\b(previous|last|earlier|old|awali|zamani|jana)\b/i.test(past[0])) {
    const noun = String(past[1] || past[2] || 'booking').toLowerCase();
    cues.push(`past_${noun === 'ombi' ? 'request' : noun}`);
  }
  try {
    if (require('./fileRead').looksLikeOfferAsk(value)) cues.push('offer_ask');
  } catch (_) {
    /* fileRead absent: no cue */
  }
  return cues;
}

function cueTopic(cues = []) {
  const list = Array.isArray(cues) ? cues : [];
  const past = list.filter((cue) => cue.startsWith('past_')).slice(-1)[0];
  if (past) return `a previous ${past.slice(5)}`;
  if (list.includes('offer_ask')) return 'the services you offer';
  return '';
}

/** The deterministic owner line from the topic (flag on). */
function ownerReasonFromTopic({ who = 'Caller', topic = null, person = null, primaryIntent = '' } = {}) {
  const name = clean(who, 80) || 'Caller';
  if (person?.name) {
    const also = topic && !/^speaking to /i.test(topic) ? ` They also asked about ${topic}.` : '';
    return clean(`${name} asked for ${personLabel(person)}.${also}`, 220);
  }
  if (topic) return clean(`${name} asked about ${topic.replace(/[.?!]+$/g, '')}.`, 220);
  if (primaryIntent === 'human') return clean(`${name} needs you to return the call.`, 220);
  return clean(`${name} called. No clear ask.`, 220);
}

/** The "asked about Y" object is the caller's own words (or a closing), not a topic. */
function askedAboutIsCallerWords(text, callerTurns = []) {
  const match = String(text || '').match(/\basked about\s+(.+?)[.!?]*$/i);
  if (!match) return false;
  const object = norm(match[1]);
  if (!object) return true;
  if (require('./callFixesD199').notAGoal(match[1])) return true;
  return (Array.isArray(callerTurns) ? callerTurns : []).some((turn) => {
    const said = norm(turn);
    return said && (said === object || (object.split(' ').length >= 2 && said.includes(object)));
  });
}

/** "asked about Chris" / "asked for Chris" -> "asked for Chris (Manager)". */
function askedForPerson(text, person) {
  const value = String(text || '');
  if (!person?.name || !value) return value;
  const first = norm(person.name).split(' ').filter((w) => !TITLES.has(w))[0] || '';
  const names = [person.name, first].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\basked (?:about|for) (${names.join('|')})\\b(?!\\s*\\()`, 'i');
  return value.replace(re, `asked for ${personLabel(person)}`);
}

module.exports = {
  catalogueTopicNames,
  catalogueHits,
  teamPeople,
  teamPersonNamed,
  personLabel,
  isGarbledItem,
  isItemList,
  countQuantity,
  itemTopic,
  intentTopic,
  turnCues,
  cueTopic,
  topicName,
  summaryTopic,
  ownerReasonFromTopic,
  askedAboutIsCallerWords,
  askedForPerson,
};
