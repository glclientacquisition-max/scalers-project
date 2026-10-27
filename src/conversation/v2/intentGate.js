'use strict';
// VOICE_NLU_FIRST_INTENT (default off): Brain nlu decides the catalogue intent;
// the separate Gemini classify runs only when nlu is unsure (explain/price with
// no bound service id, a list-vs-book conflict, or an empty read inside a locked
// topic). Every decision is traced as intentSource = nlu | model | skip.
const N = require('./nlu');
const SC = require('../../knowledge/spokenCatalogue');

const on = (v) => /^(1|true|on|yes)$/i.test(String(v || '').trim());
const nluFirstEnabled = (env = process.env) => on(env.VOICE_NLU_FIRST_INTENT);
const intentInMainTurnEnabled = (env = process.env) => nluFirstEnabled(env) && on(env.VOICE_INTENT_IN_MAIN_TURN);

/** -> { intent, service_id, confidence: 'high'|'low', reason } */
// Brain nlu also returns { kind, confidence: 0-1, clear, reason } on every turn; it is passed
// through as score/clear. Under BRAIN_V2_NLU_GAPS the gap rules (book outranks list, service
// check, price rules A/B, "wewe niambie") set the kind; off, the reads below are unchanged.
function nluIntent(text, { profile = {}, doc = null, topic = null, prev = null, opening = false, now = new Date(), gaps } = {}) {
  const u = N.understand(text, { profile, now, topic, prev, opening, gaps });
  const res = gate(u, doc, topic);
  return { ...res, score: u.confidence, clear: res.confidence === 'high', nluKind: u.kind, nluReason: u.reason, service: u.service || null };
}
function gate(u, doc, topic) {
  const has = (k) => u.intents.includes(k);
  const entry = doc && u.service ? SC.entryForRaw(doc, typeof u.service === 'string' ? u.service : u.service.name) : null;
  const sid = entry ? entry.id : null;
  if (u.kind === 'book_service') return { intent: 'other', service_id: sid, confidence: 'high', reason: 'book_outranks_list' };
  if (u.kind === 'check_service') return sid ? { intent: 'explain_service', service_id: sid, confidence: 'high', reason: 'service_check' } : { intent: 'explain_service', service_id: null, confidence: 'low', reason: 'no_service_id' };
  if (/^rule_|^tell_me/.test(u.reason || '')) {
    const intent = u.kind === 'list_services' ? 'list_services' : 'price_service';
    if (intent === 'list_services' || sid) return { intent, service_id: intent === 'list_services' ? null : sid, confidence: 'high', reason: u.reason };
  }
  if (has('explain') || has('price')) {
    const intent = has('price') ? 'price_service' : 'explain_service';
    if (sid) return { intent, service_id: sid, confidence: 'high', reason: 'service_bound' };
    return { intent, service_id: null, confidence: 'low', reason: 'no_service_id' };
  }
  if (has('services')) {
    if (has('book')) return { intent: 'list_services', service_id: null, confidence: 'low', reason: 'conflict_book' };
    return { intent: 'list_services', service_id: null, confidence: 'high', reason: u.followup ? 'services_followup' : 'services' };
  }
  // Inside the catalogue step an empty read is never confident: the step only runs on a catalogue cue or a locked topic.
  return { intent: 'other', service_id: null, confidence: 'low', reason: topic ? 'empty_in_topic' : 'no_catalogue_intent' };
}

// VOICE_INTENT_IN_MAIN_TURN: the same command folded into the main Gemini turn as a
// ###TOOL### key. Shadow only: logged next to the nlu decision, never spoken or applied.
function foldInstruction(doc) {
  if (!doc || !Array.isArray(doc.entries) || !doc.entries.length) return '';
  const menu = doc.entries.map((e) => `${e.id}=${e.raw.name}`).join('; ');
  return [
    'Also, inside your usual ###TOOL### block (add one if you have none), include',
    '"catalogue_intent": {"intent": "list_services"|"explain_service"|"price_service"|"other", "service_id": <one id below or null>}',
    'classifying the caller\'s latest turn. Never say it aloud. Service ids: ' + menu,
  ].join(' ');
}
function foldedFromParsed(parsed, doc) {
  const raw = parsed && parsed.catalogueIntent;
  if (!raw || typeof raw !== 'object') return null;
  const intent = ['list_services', 'explain_service', 'price_service', 'other'].includes(raw.intent) ? raw.intent : null;
  const ids = new Set((doc?.entries || []).map((e) => e.id));
  const service_id = raw.service_id && ids.has(raw.service_id) ? raw.service_id : null;
  return intent ? { intent, service_id } : { invalid: true };
}

module.exports = { nluFirstEnabled, intentInMainTurnEnabled, nluIntent, foldInstruction, foldedFromParsed };
