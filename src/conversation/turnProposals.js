'use strict';
// VOICE_TURN_ARBITER: turns every mouth's output for one caller turn into
// proposals for TurnArbiter.speak(). Only catalogue / price / service-fact
// turns are claimed; every other turn returns [] and the existing path runs.
// Legacy and Brain catalogue lines may propose but never emit their own
// words while a pinned spoken catalogue exists: they are re-rendered from it.
const { isBackchannel, isHello } = require('../speech/turnArbiter');

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

// Brain review: current turn's language; a confirmed name only (never the first ASR token).
function closerAfterNameYes({ name, nameConfirmed = false, lang }) {
  const L = lang2(lang);
  const who = nameConfirmed ? String(name || '').trim() : '';
  if (L === 'sw') return `Asante${who ? `, ${who}` : ''}. Kati ya huduma nilizotaja, ungependa ipi?`;
  return `Thanks${who ? `, ${who}` : ''}. Which of those would you like?`;
}

function buildTurnProposals({ text, lang, doc, docVersion = null, localReply = null, legacyMouth = null, v2Mouth = null, groundedPrice = '', nameJustConfirmed = false, callerName = '', callerNameConfirmed = false, catalogueListed = false, lock = null } = {}) {
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
  // Name-yes hands back to the open question: one closer, list kept as is
  // (a fact the caller is still owed wins instead).
  if (nameJustConfirmed && locked && catalogueListed && !out.some((p) => p.topic === 'price')) {
    out.length = 0;
    out.push({ source: 'name_yes_closer', topic: 'catalogue', line: closerAfterNameYes({ name: callerName, nameConfirmed: callerNameConfirmed, lang: L }) });
  }
  // A backchannel / barge fragment inside a locked catalogue topic keeps the
  // topic: re-ask the open question instead of letting Gemini re-list.
  if (locked && !nameJustConfirmed && !out.length) {
    // "Hello?" inside the topic replays the last line; a backchannel re-asks the open question.
    const last = Array.isArray(lock.lines) && lock.lines.length ? lock.lines[lock.lines.length - 1] : '';
    if (isHello(text) && last) out.push({ source: 'topic_hold', topic: 'catalogue', line: last, facts: { replay: true } });
    else if (isBackchannel(text, lock)) out.push({ source: 'topic_hold', topic: 'catalogue', line: lock.lang === L && lock.openQuestion ? lock.openQuestion : openQuestionOf('', L) });
  }
  return out;
}

module.exports = { buildTurnProposals, categoryLine, closerAfterNameYes, openQuestionOf };
