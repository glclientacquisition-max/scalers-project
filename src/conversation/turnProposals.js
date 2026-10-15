'use strict';
// VOICE_TURN_ARBITER: turns every mouth's output for one caller turn into
// proposals for TurnArbiter.speak(). Only catalogue / price / service-fact
// turns are claimed; every other turn returns [] and the existing path runs.
// Legacy and Brain catalogue lines may propose but never emit their own
// words while a pinned spoken catalogue exists: they are re-rendered from it.
const { isBackchannel } = require('../speech/turnArbiter');

const lang2 = (l) => (/^(sw|sheng)/i.test(String(l || '')) ? 'sw' : 'en');
const openQuestionOf = (line, lang) => {
  const qs = String(line || '').match(/[^.!?]*\?\s*$/);
  return (qs && qs[0].trim()) || (lang === 'sw' ? 'Ungependa ipi?' : 'Which would you like?');
};

// The stored doc's category line (also the Gemini-timeout line, per Brain).
function categoryLine(doc, lang) {
  if (!doc || !Array.isArray(doc.categories)) return '';
  const L = lang2(lang);
  const labels = doc.categories.map((c) => c[L]).filter(Boolean).slice(0, 4);
  if (!labels.length) return '';
  return require('./v2/receipts').info({ kind: 'service_categories', labels }, L);
}

function closerAfterNameYes({ name, lock, lang }) {
  const L = lang2(lock?.lang || lang);
  const who = String(name || '').trim().split(/\s+/)[0];
  const oq = lock?.openQuestion || openQuestionOf('', L);
  if (L === 'sw') return `Asante${who ? `, ${who}` : ''}. ${oq}`;
  return `Thank you${who ? `, ${who}` : ''}. ${oq}`;
}

function buildTurnProposals({ text, lang, doc, docVersion = null, localReply = null, legacyMouth = null, v2Mouth = null, groundedPrice = '', nameJustConfirmed = false, callerName = '', catalogueListed = false, lock = null } = {}) {
  const L = lang2(lang);
  const out = [];
  const locked = lock && lock.topic === 'catalogue';
  const catLock = (line, step) => ({ topic: 'catalogue', step, docVersion, openQuestion: openQuestionOf(line, L), lang: L });
  if (v2Mouth && v2Mouth.reason === 'v2_catalogue' && v2Mouth.line) {
    out.push({ source: 'v2_catalogue', topic: 'catalogue', line: v2Mouth.line, facts: { docVersion, kind: v2Mouth.v2?.kind || null }, lock: catLock(v2Mouth.line, v2Mouth.v2?.kind || 'list') });
  }
  const docLine = categoryLine(doc, L);
  const asCatalogue = (source, line) => {
    if (!line) return;
    // Legacy may propose, never emit: with a pinned doc the doc's line is spoken.
    if (docLine && !catalogueListed) out.push({ source, topic: 'catalogue', line: docLine, facts: { docVersion, renderedFrom: source }, lock: catLock(docLine, 'list') });
    else if (!docLine && !catalogueListed) out.push({ source, topic: 'catalogue', line, lock: catLock(line, 'list') });
  };
  if (legacyMouth?.speakLocal && legacyMouth.line && legacyMouth !== v2Mouth && legacyMouth.reason !== 'v2_catalogue') asCatalogue('legacy_catalogue', legacyMouth.line);
  else if (v2Mouth && v2Mouth.reason !== 'v2_catalogue' && v2Mouth.speakLocal && v2Mouth.line) asCatalogue('legacy_catalogue', v2Mouth.line);
  if (localReply?.outcome === 'catalogue') asCatalogue('local_catalogue', localReply.line);
  if (groundedPrice) out.push({ source: 'grounded_price', topic: 'price', line: groundedPrice });
  if (localReply && ['price', 'service_facts', 'service_fact'].includes(localReply.outcome) && localReply.line) out.push({ source: 'service_facts', topic: 'price', line: localReply.line });
  // Inside the catalogue lock, a follow-up v2 did not read but that names a
  // pinned-doc service is answered from the doc (never left to live Gemini).
  if (locked && !out.length && doc && !isBackchannel(text) && !nameJustConfirmed) {
    const SC = require('../knowledge/spokenCatalogue');
    const R = require('./v2/receipts');
    const e = SC.findEntry(text, doc);
    if (e) {
      const cat = doc.categories.find((c) => c.id === e.category?.id);
      const sizes = cat && cat.id === 'house' ? cat.entryIds.map((id) => (doc.entries.find((x) => x.id === id)?.raw?.name.match(/(\d)-Bedroom/i) || [])[1]).filter(Boolean) : [];
      const line = sizes.length > 1 ? R.info({ kind: 'house_sizes', sizes }, L) : e.explain?.[L] ? `${e.explain[L]} ${lock.openQuestion || openQuestionOf('', L)}` : '';
      if (line) out.push({ source: 'v2_catalogue', topic: 'catalogue', line, facts: { docVersion, entry: e.id, renderedFrom: 'locked_followup' } });
    }
  }
  // Name-yes hands back to the open question: one closer, list kept as is
  // (a fact the caller is still owed wins instead).
  if (nameJustConfirmed && locked && catalogueListed && !out.some((p) => p.topic === 'price')) {
    out.length = 0;
    out.push({ source: 'name_yes_closer', topic: 'catalogue', line: closerAfterNameYes({ name: callerName, lock, lang: L }) });
  }
  // A backchannel / barge fragment inside a locked catalogue topic keeps the
  // topic: re-ask the open question instead of letting Gemini re-list.
  if (locked && !nameJustConfirmed && isBackchannel(text) && !out.length) out.push({ source: 'topic_hold', topic: 'catalogue', line: lock.openQuestion || openQuestionOf('', L) });
  return out;
}

module.exports = { buildTurnProposals, categoryLine, closerAfterNameYes, openQuestionOf };
