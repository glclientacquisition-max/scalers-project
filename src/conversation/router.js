'use strict';
// Code answers for the simple fact intents, before the model is called.
// A turn is answered only when the intent and the entity both resolve on
// THIS turn. The one carry-over is a bare re-ask of the same item
// ("how much is it?", "travel fee?"). Anything else leaves the model path
// untouched. VOICE_LOOKUPS default off: this returns null and does not
// write topic state.

const { enabledKinds } = require('../knowledge/flags');
const { lookup, speechOf } = require('../knowledge/lookup');

const PAY = /\b(till|pay\s?bill|paybill|pochi|namba ya (?:till|malipo|akaunti)|how (?:do|can) i pay|lipa na|account number|bank account|\bcard\b)\b/i;
const FEE = /\b(travel fee|delivery fee|ada ya usafiri|ada ya delivery|mnafika|mnakuja|do you come to|do you (?:cover|reach|go to)|come to|fee to|usafiri hadi|travel to)\b/i;
const HOURS = /\b(opening hours|what time (?:do you|are you)|are you open|open now|closing time|working hours|mnafungua|mnafunga|mko wazi|saa za kazi|what are your hours|when do you open|when do you close)\b/i;
const CLOCK = /\b(what time is it|what(?:'s| is) the time|saa ngapi)\b/i;
const SERVICES = /\b(which services|what services|services do you|huduma gani|mnafanya nini|what do you (?:do|offer)|list of services)\b/i;
const PRICE = /\b(how much|price|pricing|bei|pesa ngapi|ni ngapi|kiasi|how much is)\b/i;
const CUTOFF = /\bhow much is (?:the|a|an)\s*[.?!]?\s*$/i;
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
  if (!hit) return null;
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
  if (hit.kind === 'price' && found.status === 'not_on_file' && !barePrice && scoreMightBeEmpty(text)) {
    // "how much" with no named service is the model path, unless it is the cut-off.
    return null;
  }
  if (hit.kind === 'fee' && found.status === 'not_on_file' && !placeish(text)) return null;
  return { kind: hit.kind, found, query, cutoff: hit.cutoff };
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
