'use strict';
// BRAIN_V2_TOPIC_PROPOSALS (default off). Topic state, grounded-name post-check,
// name-yes hand-back, doc fallback and v2 output as proposals for Voice's
// TurnArbiter (VOICE_TURN_ARBITER). Flag off: nothing here runs.
//
// Topic TTL = 2 caller turns. Staging calls show the inherited turn comes right
// after the answer: a filler/barge-in ("Karibu.", HD_f9b67efaf590) then, at most,
// one more short turn (a name confirm, HD_73fa119a7435) before the real follow-up.
// 1 drops the topic on the second of those; 3 would let a stale list answer
// claim a turn after the caller has clearly moved on. Any clear intent ends the
// topic at once; an on-topic v2 answer refreshes it.
const ON = /^(1|true|on|yes)$/i;
const enabled = (env = process.env) => ON.test(String(env.BRAIN_V2_TOPIC_PROPOSALS || '').trim());
const TOPIC_TTL = 2;

const PRIORITY = { catalogue: 80, explain: 80, price: 80, area: 75, name_handback: 72, reprompt: 70, fallback: 60, turn: 50 };

// ---------- 1. topic state ----------
function setTopic(state, { kind, itemIds = [], turn }) {
  state.topic = { kind, itemIds: [...new Set(itemIds)].slice(0, 12), setTurn: turn, ttl: TOPIC_TTL };
  return state.topic;
}
function liveTopic(state, turn) {
  const t = state?.topic;
  if (!t) return null;
  if (turn - t.setTurn > t.ttl) { state.topic = null; return null; }
  return t;
}
function clearTopic(state) { if (state) state.topic = null; }
// Barge-in, filler or short ack: inherits the topic (v2 keeps the turn).
const FILLER = /^\W*((karibu|eeh+|eh|ee|sawa|sawa sawa|ok(ay)?|mm+|mhm+|m-?hm|aha|ah+|oh|uh+|um+|hmm+|ndio|ndiyo|naam|yeah|yes|haya|poa|alright|niulize|nisikize|si(ki)?liza|hello|halo|na(m)?skia|i see)\W*){1,3}$/i;
function inheritsTopic(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (FILLER.test(t)) return true;
  if (/[—–-]\s*$/.test(t) && t.split(/\s+/).length <= 3) return true; // cut off by a barge-in
  return false; // one-word content ("Kitengela.", "Juja.") is an answer, not filler
}

// ---------- 2. item-name post-check (pure; Gemini or legacy lines) ----------
const NAME_WORDS = /\b(cleaning|clean|wash|washing|housekeeping|fumigation|control|upholstery|laundry|contract|package)\b/i;
const SKIP = new Set(['and', 'na', 'or', 'au', 'the', 'a', 'of', 'per', 'we', 'our', 'tuna', 'tunafanya', 'tuna-offer', 'offer', 'which', 'one', 'do', 'you', 'need', 'for', 'is', 'from', 'standard', 'add', 'on']);
const norm = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/(\d)\s*-\s*(bed)/g, '$1-$2').replace(/[^a-z0-9- ]+/g, ' ').replace(/\s+/g, ' ').trim();
function docPhrases(doc) {
  const out = new Set();
  for (const e of doc?.entries || []) for (const n of [e.raw?.name, e.spoken?.en, e.spoken?.sw, e.category?.en, e.category?.sw]) if (n) out.add(norm(n));
  for (const c of doc?.categories || []) for (const n of [c.en, c.sw]) if (n) for (const p of String(n).split(/,|\bna\b|\band\b|\bau\b|\bor\b|\blike\b|\bkama\b/i)) if (p.trim()) out.add(norm(p));
  return [...out].filter(Boolean);
}
// Catalogue-style mentions: Title Case runs ending in a service word ("Apartment na House Cleaning"),
// "N-Bedroom" names, and lowercase "<word(s)> cleaning".
function mentions(line) {
  const s = String(line || '');
  const out = [];
  const title = /((?:\b(?:\d-)?[A-Z][\w'/-]*\s+(?:(?:and|na|&)\s+)?){1,4})(Cleaning|Clean|Wash|Housekeeping|Fumigation|Control|Contract|Package)\b/g;
  for (const m of s.matchAll(title)) out.push({ text: `${m[1]}${m[2]}`.trim(), title: true });
  for (const m of s.matchAll(/\b\d\s*-\s*Bedroom\b/gi)) out.push({ text: m[0], title: true });
  for (const m of s.matchAll(/\b((?:[a-z][a-z-]+\s+){1,2})(cleaning|clean)\b/g)) out.push({ text: m[0], title: false });
  return out;
}
function covered(mention, phrases, words) {
  const m = norm(mention.text);
  if (phrases.some((p) => p === m || p.includes(m) || (m.length > 6 && m.includes(p) && p.split(' ').length >= 2))) return true;
  if (mention.title) return false; // a Title Case catalogue name must match the doc
  const content = m.split(' ').filter((w) => w.length >= 3 && !SKIP.has(w) && !NAME_WORDS.test(w));
  return content.length > 0 && content.every((w) => words.has(w) || words.has(w.replace(/e?s$/, '')));
}
/**
 * itemNamePostCheck(line, doc, { legacyNames }) -> { ok, line, offending[] }
 * ok=false and line=null when the line names a catalogue item (or a legacy name) that is not in the doc.
 */
function itemNamePostCheck(line, doc, { legacyNames = [] } = {}) {
  const text = String(line || '');
  if (!text.trim() || !doc || !Array.isArray(doc.entries)) return { ok: true, line: text, offending: [] };
  const phrases = docPhrases(doc);
  const words = new Set(phrases.join(' ').split(' ').filter((w) => w.length >= 3));
  const offending = [];
  for (const ln of legacyNames) if (ln && new RegExp(`\\b${String(ln).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text) && !phrases.includes(norm(ln))) offending.push(ln);
  for (const m of mentions(text)) if (!covered(m, phrases, words)) offending.push(m.text);
  const uniq = [...new Set(offending.map((o) => String(o).replace(/^(?:(?:tuna|tunafanya|we|do|offer|our)\s+)+/i, '').trim()))];
  return uniq.length ? { ok: false, line: null, offending: uniq } : { ok: true, line: text, offending: [] };
}

// ---------- 3. name-yes hand-back / question dedupe ----------
const WHICH_SERVICE = /\b(which (service|one)[^.?!]*\?|what service[^.?!]*\?|ungependa (huduma )?(gani|ipi)[^.?!]*\?|unahitaji (huduma )?(gani|ipi)[^.?!]*\?|huduma gani[^.?!]*\?)/gi;
function countWhichService(line) { return (String(line || '').match(WHICH_SERVICE) || []).length; }
// One "which service?" per line, and never the same one as the previous turn.
function dedupeQuestions(line, { lastLine = '' } = {}) {
  const parts = String(line || '').split(/(?<=[.!?])\s+/).filter(Boolean);
  const seen = []; const out = [];
  const lastAsked = countWhichService(lastLine) > 0;
  for (const p of parts) {
    const q = countWhichService(p) > 0;
    if (q && (seen.length || (lastAsked && out.length))) continue;
    if (q) seen.push(p);
    out.push(p);
  }
  return out.join(' ').trim();
}
function openQuestion(line) { const m = String(line || '').match(/[^.!?]*\?\s*$/); return m ? m[0].trim() : null; }

// ---------- 4. pinned doc + fallback ----------
// Pinned once at call start from tenants.spoken_catalogue; never compiled on the hot path.
function pinDoc(state, profile) {
  if (state.pinnedDoc === undefined && profile?.spokenCataloguePin?.doc) state.pinnedDoc = profile.spokenCataloguePin.doc; // Voice's call-start pin (#705/#706)
  // No call-start pin: the freshness-checked lookup (never a stale stored doc as is)
  if (state.pinnedDoc === undefined) state.pinnedDoc = profile?.spokenCatalogue && Array.isArray(profile.spokenCatalogue.categories) ? require('../../knowledge/spokenCatalogue').pinSpokenCatalogue(profile)?.doc || null : null;
  return state.pinnedDoc;
}
function fallbackLine(doc, lang) {
  const L = /^(sw|sheng)/.test(String(lang || '')) ? 'sw' : 'en';
  const cats = (doc?.categories || []).map((c) => c?.[L]).filter(Boolean);
  if (!cats.length) return null;
  const list = cats.length > 1 ? `${cats.slice(0, -1).join(', ')}${L === 'sw' ? ' na ' : ', and '}${cats[cats.length - 1]}` : cats[0];
  return L === 'sw' ? `Tunafanya ${list}. Ungependa ipi?` : `We do ${list}. Which would you like?`;
}

// ---------- 5. proposals ----------
function proposal({ kind, text, lang, topic = null, claim = false, priority }) {
  return { source: 'v2', kind, text, lang: /^(sw|sheng)/.test(String(lang || '')) ? 'sw' : 'en', priority: priority ?? PRIORITY[kind] ?? 50, topic: topic ? { kind: topic.kind, itemIds: topic.itemIds, ttlLeft: Math.max(0, topic.ttl - ((topic.now ?? topic.setTurn) - topic.setTurn)) } : null, claim: Boolean(claim) };
}

// Voice's TurnArbiter (#706 src/speech/turnArbiter.js) proposal shape:
// {source, topic, line, grounded, facts, lock?}. source picks the arbiter PRIORITY;
// claim:false proposals are not submitted (the existing path keeps the turn).
const ARBITER_SOURCE = { catalogue: 'v2_catalogue', fallback: 'v2_catalogue', explain: 'v2_catalogue', area: 'v2_catalogue', reprompt: 'topic_hold', name_handback: 'name_yes_closer', price: 'grounded_price' };
function toArbiter(p, { docVersion = null } = {}) {
  if (!p || !p.claim || !p.text || !ARBITER_SOURCE[p.kind]) return null;
  const topic = p.kind === 'price' ? 'price' : 'catalogue';
  const openQuestion = (String(p.text).match(/[^.!?]*\?\s*$/) || [])[0]?.trim() || null;
  const out = { source: ARBITER_SOURCE[p.kind], topic, line: p.text, grounded: true, facts: { docVersion, kind: p.kind, lang: p.lang, itemIds: p.topic?.itemIds || [], from: 'brain_v2' } };
  if (p.kind === 'catalogue' || p.kind === 'fallback') out.lock = { topic: 'catalogue', step: p.kind === 'fallback' ? 'list' : 'list', docVersion, openQuestion, lang: p.lang };
  return out;
}

module.exports = { toArbiter, ARBITER_SOURCE, enabled, TOPIC_TTL, PRIORITY, setTopic, liveTopic, clearTopic, inheritsTopic, itemNamePostCheck, countWhichService, dedupeQuestions, openQuestion, pinDoc, fallbackLine, proposal };
