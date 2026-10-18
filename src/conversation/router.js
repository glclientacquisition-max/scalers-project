'use strict';
// Code answers for the simple fact intents, before the model is called.
// A turn is answered only when the intent and the entity both resolve on
// THIS turn. The one carry-over is a bare re-ask of the same item
// ("how much is it?", "travel fee?"). Anything else leaves the model path
// untouched. VOICE_LOOKUPS default off: this returns null and does not
// write topic state.

const { enabledKinds } = require('../knowledge/flags');
const { lookup, speechOf, matchCatalogueFollowUp } = require('../knowledge/lookup');

const PAY = /\b(till|pay\s?bill|paybill|pochi|namba ya (?:till|malipo|akaunti)|how (?:do|can) i pay|lipa na|account number|bank account|\bcard\b)\b/i;
const FEE = /\b(travel fee|delivery fee|ada ya usafiri|ada ya delivery|mnafika|mnakuja|do you come to|do you (?:cover|reach|go to)|come to|fee to|usafiri hadi|travel to)\b/i;
const HOURS = /\b(opening hours|what time (?:do you|are you)|are you open|open now|closing time|working hours|mnafungua|mnafunga|mko wazi|saa za kazi|what are your hours|when do you open|when do you close)\b/i;
const CLOCK = /\b(what time is it|what(?:'s| is) the time|saa ngapi)\b/i;
const SERVICES = /\b(which services|what services|services do you|huduma gani|mnafanya nini|what do you (?:do|offer)|list of services)\b/i;
const PRICE = /\b(how much|price|pricing|bei|pesa ngapi|ni ngapi|kiasi|how much is)\b/i;
const CUTOFF = /\bhow much is (?:the|a|an)\s*[.?!\u2026\u2014\u2013-]*\s*$/i;
const BARE_PRICE = /^\W*(?:uh[, ]+|um[, ]+|and[, ]+)?(?:so[, ]+)?(?:how much(?: is it)?|bei gani|ni pesa ngapi|ni ngapi)\s*[.?!]?\s*$/i;
const BARE_FEE = /^\W*(?:uh[, ]+|um[, ]+|and[, ]+)?(?:the )?(?:travel|delivery) fee\s*[.?!]?\s*$|^\W*ada ya usafiri\s*[.?!]?\s*$/i;
const HELP_ONLY = /^\W*(?:uh[, ]+|um[, ]+)?(?:okay|ok|i need your help|can you help(?: me)?|unisaidie|nisaidie)\s*[.?!]?\s*$/i;
const BOOK_ONLY = /\b(book|booking|kubook|appointment|schedule)\b/i;

function blankTopic() {
  return { intent: '', serviceId: '', areaId: '', payKind: '' };
}

function readTopic(state) {
  const topic = state?.conversation?.lookupTopic;
  return topic ? { ...topic } : blankTopic();
}

function writeTopic(state, topic) {
  if (!state || typeof state !== 'object') return;
  if (!state.conversation || typeof state.conversation !== 'object') state.conversation = {};
  state.conversation.lookupTopic = { ...topic };
}

function classify(text) {
  const raw = String(text || '').trim();
  if (!raw || HELP_ONLY.test(raw)) return null;
  if (BOOK_ONLY.test(raw) && !PRICE.test(raw) && !FEE.test(raw) && !HOURS.test(raw) && !PAY.test(raw)) return null;
  if (PAY.test(raw)) return { kind: 'pay', bare: false, cutoff: false };
  if (FEE.test(raw)) return { kind: 'fee', bare: BARE_FEE.test(raw), cutoff: false };
  if ((HOURS.test(raw) || CLOCK.test(raw)) && !FEE.test(raw)) return { kind: 'hours', bare: false, cutoff: false };
  if (SERVICES.test(raw)) return { kind: 'services', bare: false, cutoff: false };
  if (CUTOFF.test(raw)) return { kind: 'services', bare: false, cutoff: true };
  if (PRICE.test(raw) || BARE_PRICE.test(raw)) return { kind: 'price', bare: BARE_PRICE.test(raw), cutoff: false };
  if (BARE_FEE.test(raw)) return { kind: 'fee', bare: true, cutoff: false };
  return null;
}

function entityReady(kind, text, topic) {
  if (kind === 'pay' || kind === 'hours' || kind === 'services') return true;
  if (kind === 'fee') {
    if (BARE_FEE.test(text) && topic.areaId) return true;
    // A place-ish token longer than a filler, or the bare slot.
    if (/\b[A-Za-z]{4,}\b/.test(text) && !BARE_FEE.test(text)) return true;
    return false;
  }
  if (kind === 'price') {
    if (BARE_PRICE.test(text)) return Boolean(topic.serviceId);
    return true;
  }
  return false;
}

const FEE_STOP = new Set(['much', 'travel', 'delivery', 'fee', 'fees', 'usafiri', 'mnafika', 'mnakuja', 'come', 'cover', 'reach', 'your', 'what', 'how', 'that', 'this', 'with', 'from', 'have', 'does', 'ada']);

function placeish(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .some((w) => w.length >= 4 && !FEE_STOP.has(w));
}

function applyTopic(topic, kind, found, cutoff) {
  topic.intent = cutoff ? 'services' : kind;
  if (kind === 'fee' || kind === 'hours' || kind === 'pay' || kind === 'services' || cutoff) topic.serviceId = '';
  if (kind === 'price' && found?.status === 'found' && String(found.id || '').startsWith('price.')) {
    topic.serviceId = found.id;
  }
  if (kind === 'fee' && found?.status === 'found' && String(found.id || '').startsWith('fee.') && found.id !== 'fee.out') {
    topic.areaId = found.id;
  }
  if (kind === 'pay' && found?.id) topic.payKind = found.id;
}

function answerOne(text, ctx, topic) {
  const hit = classify(text);
  if (!hit) return followUpAnswer(text, ctx, topic);
  if (!ctx.kinds.has(hit.kind === 'fee' ? 'fee' : hit.kind)) return null;
  const bareFee = hit.kind === 'fee' && hit.bare && topic.areaId;
  const barePrice = hit.kind === 'price' && hit.bare && topic.serviceId;
  if (hit.kind === 'price' && hit.bare && !topic.serviceId) {
    // Empty slot: catalogue clarify, not the last service.
    if (!ctx.kinds.has('services')) return null;
    const found = lookup('services', text, ctx.lookupCtx);
    return { kind: 'services', found, query: text, cutoff: true };
  }
  if (!entityReady(hit.kind, text, topic) && !bareFee && !barePrice) return null;
  let query = text;
  if (bareFee) query = topic.areaId.replace(/^fee\./, '').replace(/_/g, ' ');
  if (barePrice) query = topic.serviceId.replace(/^price\./, '').replace(/_/g, ' ');
  const lookupKind = hit.kind === 'fee' ? 'area_fee' : hit.kind;
  const found = lookup(lookupKind, query, ctx.lookupCtx);
  const absent = found.status === 'not_on_file' || found.status === 'no_data' || found.status === 'not_found_in_list';
  if (hit.kind === 'price' && absent && !barePrice && scoreMightBeEmpty(text)) {
    // "how much" with no named service is the model path, unless it is the cut-off.
    return null;
  }
  if (hit.kind === 'fee' && absent && !placeish(text)) return null;
  return { kind: hit.kind, found, query, cutoff: hit.cutoff };
}

// A coverage ask that names a known place, whatever the verb: "do you do
// Kileleshwa", "mnafanya Kileleshwa?" (staging call 2026-10-19).
const ASK_FORM = /\?\s*$|\b(do you|does|can you|are you|will you|would you|is there|know if|wanted to know|want to know|nauliza|nataka kujua|ningependa kujua|je|mna\w*|mko|una(?:fanya|enda|fika|kuja))\b/i;
const PLACE_STOP = new Set([
  'athi', 'biashara', 'chache', 'daima', 'holds', 'hotel', 'imara', 'junction', 'kubwa', 'mbili', 'mtaa',
  'ndogo', 'point', 'range', 'state', 'sukari', 'tayari', 'total', 'wangu', 'kenya', 'mara', 'kuku',
  'office', 'carpet', 'market', 'station', 'centre', 'center', 'estate', 'road', 'river', 'hill',
]);
let PLACES = null;
function placeIndex() {
  if (!PLACES) {
    try {
      PLACES = require('./data/kenyaPlaceCounties.json').places || {};
    } catch {
      PLACES = {};
    }
  }
  return PLACES;
}

function catalogueWords(profile) {
  const words = new Set();
  for (const name of [profile?.business_name, profile?.name, profile?.agent_name, profile?.owner_name]) {
    for (const w of String(name || '').toLowerCase().split(/[^a-z]+/)) if (w) words.add(w);
  }
  for (const item of Array.isArray(profile?.services) ? profile.services : []) {
    const name = typeof item === 'string' ? item : item?.name;
    for (const w of String(name || '').toLowerCase().split(/[^a-z]+/)) if (w) words.add(w);
  }
  return words;
}

/** The known place a turn names, or ''. Capitalised names count; lowercase ones need 6+ letters. */
function namedPlace(text, profile) {
  const places = placeIndex();
  const skip = catalogueWords(profile);
  const tokens = String(text || '').split(/[^A-Za-z']+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    for (const span of [2, 1]) {
      const raw = tokens.slice(i, i + span);
      if (raw.length < span) continue;
      const key = raw.join(' ').toLowerCase();
      if (!places[key] || PLACE_STOP.has(key) || raw.some((w) => skip.has(w.toLowerCase()))) continue;
      const capital = /^[A-Z]/.test(raw[0]);
      if (key.length < 4) continue;
      if (capital && i > 0) return key;
      if (key.length >= 6) return key;
    }
  }
  return '';
}

function placeAnswer(text, ctx) {
  if (!ctx.kinds.has('fee') || !ASK_FORM.test(text)) return null;
  const place = namedPlace(text, ctx.lookupCtx.profile);
  if (!place) return null;
  const found = lookup('area_fee', text, ctx.lookupCtx);
  return { kind: 'fee', found, query: text, cutoff: false, via: 'place' };
}

// A short follow-up to an hours answer: "Na kesho?", "And Saturday?".
const DAY_WORD = /\b(leo|kesho|today|tomorrow|tonight|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili)\b/i;
function hoursFollowUp(text, topic, ctx) {
  if (topic.intent !== 'hours' || !ctx.kinds.has('hours')) return null;
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5 || !DAY_WORD.test(text)) return null;
  // "Na kesho, saa ngapi?" asks for hours on that day, not the clock.
  const query = String(text).replace(/\b(saa ngapi|what time)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const found = lookup('hours', query, ctx.lookupCtx);
  return { kind: 'hours', found, query, cutoff: false, via: 'follow_up' };
}

function followUpAnswer(text, ctx, topic = blankTopic()) {
  const hours = hoursFollowUp(text, topic, ctx);
  if (hours) return hours;
  const place = placeAnswer(text, ctx);
  if (place) return place;
  if (!ctx.kinds.has('price')) return null;
  const query = matchCatalogueFollowUp(text, ctx.lookupCtx.profile);
  if (!query) return null;
  const found = lookup('price', query, ctx.lookupCtx);
  if (found.status === 'no_data' || found.status === 'not_found_in_list') return null;
  return { kind: 'price', found, query, cutoff: false };
}

function scoreMightBeEmpty(text) {
  const generic = new Set(['how', 'much', 'is', 'the', 'a', 'an', 'price', 'bei', 'pesa', 'ngapi', 'kiasi', 'and', 'uh', 'what', 'your', 'for', 'it']);
  const words = String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !generic.has(w));
  return words.length === 0;
}

function pieces(text) {
  const raw = String(text || '').trim();
  if (/^\W*and\b/i.test(raw)) return [raw];
  const bits = raw.split(/\band\b|\bna\b/i).map((s) => s.trim()).filter((s) => s.length > 2);
  if (bits.length !== 2) return [raw];
  const a = classify(bits[0]);
  const b = classify(bits[1]);
  if (a && b && a.kind !== b.kind) return bits;
  return [raw];
}

/**
 * @returns {null | { handled: true, speech: string, outcome: string, lookups: object[], brainMs: number, dropReasons: string[], turnId: string }}
 */
function planLookupTurn({ text, state, profile, language, now, turnId, env, seed } = {}) {
  const kinds = enabledKinds(env);
  if (!kinds.size) return null;
  const started = performance.now();
  const topic = readTopic(state);
  const lookupCtx = { profile: profile || {}, language, now: now || new Date(), seed: seed || 0 };
  const ctx = { kinds, lookupCtx };
  const parts = pieces(text).slice(0, 2);
  const answers = [];
  for (const part of parts) {
    const one = answerOne(part, ctx, topic);
    if (one) answers.push(one);
  }
  if (!answers.length) return null;
  // Bare price with an empty slot becomes the services list. A cut-off does too.
  const spoken = [];
  const lookups = [];
  for (const one of answers) {
    const line = speechOf(one.found, language);
    if (!line) continue;
    spoken.push(line);
    lookups.push({ kind: one.kind, ...one.found });
    applyTopic(topic, one.kind, one.found, one.cutoff);
  }
  if (!spoken.length) return null;
  writeTopic(state, topic);
  const outcome = outcomeOf(answers[0].cutoff ? 'services' : answers[0].kind);
  return {
    handled: true,
    speech: spoken.slice(0, 2).join(' '),
    outcome,
    lookups,
    brainMs: performance.now() - started,
    dropReasons: [],
    turnId: turnId || '',
  };
}

function outcomeOf(kind) {
  if (kind === 'price') return 'price';
  if (kind === 'fee') return 'coverage';
  if (kind === 'hours') return 'hours';
  if (kind === 'services') return 'catalogue';
  return 'service_facts';
}

module.exports = { planLookupTurn, outcomeOf };
