'use strict';
// BRAIN_V2_TOPIC_PROPOSALS: v2's catalogue/topic turn as proposals for Voice's
// TurnArbiter (VOICE_TURN_ARBITER). Never speaks or commits by itself.
// proposal = { source:'v2', kind, text, lang, priority, topic:{kind,itemIds,ttlLeft}|null, claim }
//   claim:true  -> v2 owns this turn (catalogue/explain/price answer, inherited topic turn,
//                  name hand-back, doc fallback); the arbiter should not let a legacy list speak.
//   claim:false -> advisory only.
const T = require('./topic');
const step = require('./catalogueStep');
const L = require('./lexicon');

const SC = require('../../knowledge/spokenCatalogue');
const TOPIC_FOLLOW = /\b(niambie|nieleze|eleza|kuhusu|tell me( more)? about|about (the|that|this)|explain|details?|what('?s| is) (in|included)|inahusisha)\b/i;
const NAME_YES = /\b(you'?re speaking (with|to)|this is|it'?s me|ni mimi|naongea|unaongea na|ndio(,)? ni)\b/i;

// entries the caller's words fit as well as the best one ("usafi wa apartment": 1- and 2-bedroom)
function tiedEntries(text, doc, best) {
  const said = new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  const hits = (e) => new Set([e.raw.name, e.spoken?.en, e.spoken?.sw].join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => said.has(w)));
  const b = [...hits(best)].sort().join(' ');
  if (!b) return [best];
  if (/\b\d\b|\b(one|two|three|moja|mbili|tatu|kimoja|viwili|vitatu)\b/i.test(text)) return [best];
  return doc.entries.filter((e) => [...hits(e)].sort().join(' ') === b);
}
// Topic follow-up: explain the named item; ask which one when the words fit several equally.
function followUp({ text, doc, lang, profile, state, topicIds = [] }) {
  if (!doc) return null;
  // answer to our "which one: A or B?": pick among the offered items
  const subset = topicIds.length > 1 && topicIds.length <= 3 ? doc.entries.filter((x) => topicIds.includes(x.id)) : null;
  const picked = subset ? SC.findEntry(text, { entries: subset }) : null;
  if (!picked && !TOPIC_FOLLOW.test(String(text || ''))) return null;
  const e = picked || SC.findEntry(text, doc);
  if (!e) return null;
  const tied = picked ? [picked] : tiedEntries(text, doc, e);
  if (tied.length > 1) {
    const names = tied.slice(0, 3).map((x) => x.spoken?.[lang]).filter(Boolean);
    if (names.length > 1) {
      const list = `${names.slice(0, -1).join(', ')} ${lang === 'sw' ? 'au' : 'or'} ${names[names.length - 1]}`;
      return { kind: 'explain', itemIds: tied.map((x) => x.id), text: lang === 'sw' ? `Ni ipi kati ya ${list}?` : `Which one: ${list}?` };
    }
  }
  const M = require('./machine');
  const v2 = (state.v2CatalogueState ||= M.createState({ profile }));
  let kind = 'explain';
  let r = M.catalogueTurn(v2, { text, profile, lang, command: { intent: 'explain_service', service_id: e.id, language: lang } });
  if (r?.line && r.line.split(/\s+/).length <= 3) { const pr = M.catalogueTurn(v2, { text, profile, lang, command: { intent: 'price_service', service_id: e.id, language: lang } }); if (pr?.line) { r = pr; kind = 'price'; } }
  if (!r?.line) return null;
  // Bound explain/price templates are rules text for a known entry id. itemNamePostCheck is for
  // catalogue list lines (raw SKU leak); it false-positives on "It means cleaning up…".
  if (kind === 'catalogue' && !T.itemNamePostCheck(r.line, doc).ok) return null;
  return { kind, itemIds: [e.id], text: r.line };
}
function holderOf(state) { return (state.v2Topic ||= { turn: 0, lastLine: '' }); }
function langOf(holder, language, text) {
  const call = /^(sw|sheng)/i.test(String(language || '')) ? 'sw' : /^en/i.test(String(language || '')) ? 'en' : null;
  const next = L.nextLanguage(holder.lang || call, text);
  holder.lang = next || holder.lang || call || 'en';
  return /^(sw|sheng)/.test(holder.lang) ? 'sw' : 'en';
}
function itemIdsFor(doc, r) {
  if (!doc || !r) return [];
  if (r.service) { const e = doc.entries.find((x) => x.raw.name.trim().toLowerCase() === String(r.service).trim().toLowerCase()); return e ? [e.id] : []; }
  return doc.categories.flatMap((c) => c.entryIds || []);
}

/**
 * proposeTurn({ text, profile, language, state, model, timeoutMs, legacyLine }) ->
 *   { proposals: [...], legacyCheck: { ok, offending[] } | null, trace }
 * state is Voice's per-call object (v2 keeps its own fields under state.v2Topic / v2CatalogueState).
 */
async function proposeTurn({ text, profile = {}, language, state = {}, model = null, timeoutMs = 700, legacyLine = null, nameJustConfirmed = null }) {
  const h = holderOf(state); h.turn += 1;
  const doc = T.pinDoc(h, profile); // pinned at call start; no compile on the hot path
  const lang = langOf(h, language, text);
  const topic = T.liveTopic(h, h.turn);
  const legacyCheck = legacyLine && doc ? T.itemNamePostCheck(legacyLine, doc) : null;
  const out = (p, trace) => {
    if (p) { p.text = T.dedupeQuestions(p.text, { lastLine: h.lastLine }); if (p.topic) p.topic.ttlLeft = Math.max(0, T.TOPIC_TTL - (h.turn - h.topic.setTurn)); h.lastLine = p.text; h.lastLang = p.lang; }
    return { proposals: p ? [p] : [], legacyCheck, trace: { lang, turn: h.turn, topic: h.topic?.kind || null, doc: doc ? `v${doc.version}` : 'none', ...trace } };
  };
  if (!doc) return out(null, { yield: 'no_pinned_doc' });
  const pinnedProfile = { ...profile, spokenCatalogue: doc, spokenCataloguePin: { doc: doc } };

  // name confirmed while a topic is open: Voice's name_yes_closer owns the turn (#706). v2 proposes
  // nothing (no re-list, no second "which service") and hands the closer its facts.
  if (topic && (nameJustConfirmed === true || (nameJustConfirmed == null && NAME_YES.test(text)))) {
    const caller = state?.caller || {};
    const nameYes = { confirmedName: caller.nameConfirmed === true ? caller.name || null : null, lang, openQuestion: (h.lastLang === lang && T.openQuestion(h.lastLine)) || null };
    return { ...out(null, { reason: 'name_yes_yield' }), nameYes };
  }
  // a follow-up about an item while the topic is open ("Hebu niambie kuhusu hiyo usafi wa apartment") is an explain
  if (topic) {
    const f = followUp({ text, doc, lang, profile: pinnedProfile, state, topicIds: topic.itemIds });
    if (f) { T.setTopic(h, { kind: f.kind, itemIds: f.itemIds, turn: h.turn }); return out(T.proposal({ kind: f.kind, text: f.text, lang, topic: h.topic, claim: true }), { reason: 'topic_follow' }); }
  }
  let catalogueAsk = false;
  try { catalogueAsk = step.looksCatalogue(text, pinnedProfile, state); } catch { catalogueAsk = false; }
  if (catalogueAsk) {
    let r = null; let err = null;
    try { r = await step.runCatalogueStep({ text, profile: pinnedProfile, lang, state, model, timeoutMs }); } catch (e) { err = String(e?.message || e).slice(0, 40); }
    const kind = r?.trace?.kind === 'services' ? 'catalogue' : r?.trace?.kind || 'catalogue';
    if (r?.line && T.itemNamePostCheck(r.line, doc).ok) {
      T.setTopic(h, { kind, itemIds: itemIdsFor(doc, { service: r.trace?.service || null }), turn: h.turn });
      return out(T.proposal({ kind, text: r.line, lang, topic: h.topic, claim: true }), { source: r.trace?.source || 'nlu', modelError: r.trace?.modelError || null });
    }
    // timeout / failure / empty: the pinned doc's category line, never the legacy list
    const fb = T.fallbackLine(doc, lang);
    if (fb) { T.setTopic(h, { kind: 'catalogue', itemIds: itemIdsFor(doc, {}), turn: h.turn }); return out(T.proposal({ kind: 'fallback', text: fb, lang, topic: h.topic, claim: true }), { reason: err || r?.trace?.yield || 'post_check' }); }
    return out(null, { yield: 'no_categories' });
  }
  // barge-in / filler / short ack keeps the topic: v2 still owns the turn
  if (topic && T.inheritsTopic(text)) {
    const q = (h.lastLang === lang && T.openQuestion(h.lastLine)) || (lang === 'sw' ? 'Ungependa ipi?' : 'Which would you like?');
    if (q) return out(T.proposal({ kind: 'reprompt', text: q, lang, topic: h.topic, claim: true }), { reason: 'inherit' });
  }
  T.clearTopic(h);
  if (state.v2CatalogueState) state.v2CatalogueState.lastInfo = null;
  return out(null, { yield: 'not_topic' });
}

module.exports = { proposeTurn, followUp, NAME_YES };
