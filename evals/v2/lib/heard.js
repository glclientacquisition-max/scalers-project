'use strict';
// Heard-audio metrics: score what the caller actually hears, from runTurnStream's
// sentence / readback / tool events (atMs), not from the joined text line.
//   scoreHeard(calls) where calls = [[{ c: callerText, ev: [events] }, ...], ...]
const A = require('./ack');
const { langOf } = require('./score');
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);
// A filler-only sentence: nothing but an ack / hold word ("Sawa." "Okay." "One moment.").
const FILLER = /^\W*(sawa( sawa| kabisa)?|ni sawa|okay|ok|haya|alright|sure|poa|asante|thanks|um+|uh+|eh+|one moment|just a moment|subiri kidogo|ngoja kidogo|dakika moja)\W*$/i;
// Short lines that are complete on their own.
const SHORT_OK = /^\W*(yes|no|ndio|ndiyo|hapana|sawa|okay|karibu|asante|thank you|kwaheri|goodbye|bye|pole|samahani|sorry|done|great|perfect|noted)\W*$/i;
// A fragment: cut-off audio ("Hapana, n"), a dangling 1-letter word, no terminal stop, or a lone 1-word non-line.
function isFragment(s) {
  const t = String(s || '').trim(); if (!t) return false;
  if (SHORT_OK.test(t)) return false;
  const w = t.replace(/[.!?]+$/, '').split(/\s+/);
  const last = w[w.length - 1].replace(/[^\p{L}\p{N}]/gu, '');
  if (!/[.!?]$/.test(t)) return true;
  if (last.length === 1 && !/^(a|i|\d)$/i.test(last)) return true;
  if (w.length === 1 && !FILLER.test(t) && !/\?$/.test(t)) return true;
  return false;
}
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(2); };

function heardTurn(t) {
  const ev = t.ev || [];
  const sent = ev.filter((e) => e.type === 'sentence');
  const tools = ev.filter((e) => e.type === 'tool');
  const starts = tools.filter((e) => e.phase === 'start'); const ends = tools.filter((e) => e.phase === 'end');
  const first = sent[0];
  return {
    text: sent.map((s) => s.text).join(' '), sentences: sent.map((s) => s.text), lang: first?.lang || null,
    tool: starts.length > 0, write: starts.some((e) => e.write), readback: ev.some((e) => e.type === 'readback'),
    firstSentenceMs: first ? first.atMs : null,
    // dead air the tool adds: tool start -> tool end -> first spoken sentence
    preToolMs: starts.length ? starts[0].atMs : null,
    postToolMs: ends.length && first ? Math.max(0, first.atMs - ends[ends.length - 1].atMs) : null,
    toolMs: ends.reduce((a, e) => a + (e.toolMs || 0), 0),
    maxInterSentenceMs: sent.length > 1 ? Math.max(...sent.slice(1).map((s, i) => s.atMs - sent[i].atMs)) : 0,
  };
}

function scoreHeard(calls, { langOfCall = () => null } = {}) {
  const m = { calls: 0, turns: 0, heardTurns: 0, silentTurns: 0, sentences: 0, repeatedTurns: 0, repeatedSentences: 0,
    ackLed: 0, consecutiveAck: 0, fillerOnlyTurns: 0, fragments: 0, fragmentSamples: [], langTurns: 0, langMismatch: 0, langSamples: [],
    toolTurns: 0, firstMs: [], toolFirstMs: [], postToolMs: [], interMs: [] };
  calls.forEach((call, ci) => {
    m.calls++; let prev = null; let prevAck = false; const seen = new Map();
    const want0 = langOfCall(ci);
    for (const t of call) {
      if (!t.ev) continue;
      m.turns++; const h = heardTurn(t);
      if (!h.sentences.length) { m.silentTurns++; prevAck = false; continue; }
      m.heardTurns++; m.sentences += h.sentences.length;
      if (prev && norm(h.text) === norm(prev)) m.repeatedTurns++;
      for (const s of h.sentences) { const k = norm(s); if (words(s).length >= 4 && !/\?\s*$/.test(s) && seen.has(k) && seen.get(k) < m.turns - 1) m.repeatedSentences++; seen.set(k, m.turns); }
      const bye = /^(Asante kwa kupiga simu|Thank you for calling|Karibu tena\. Kwaheri)/i.test(h.text);
      const ack = !bye && A.isAck(h.text);
      if (ack) { m.ackLed++; if (prevAck) m.consecutiveAck++; } prevAck = ack;
      if (h.sentences.every((s) => FILLER.test(s))) m.fillerOnlyTurns++;
      for (const s of h.sentences) if (isFragment(s)) { m.fragments++; if (m.fragmentSamples.length < 8) m.fragmentSamples.push(s); }
      // language: what was heard vs the caller's language (call label, else this caller turn)
      const want = want0 || (langOf(t.c || '') === 'unknown' ? null : langOf(t.c || ''));
      const got = langOf(h.text);
      if (want && got !== 'unknown') { m.langTurns++; const w = /^(sw|sheng)/.test(want) ? 'sw' : 'en'; if (got !== w) { m.langMismatch++; if (m.langSamples.length < 5) m.langSamples.push(h.text.slice(0, 80)); } }
      m.firstMs.push(h.firstSentenceMs);
      if (h.tool) { m.toolTurns++; m.toolFirstMs.push(h.firstSentenceMs); if (h.postToolMs != null) m.postToolMs.push(h.postToolMs); }
      m.interMs.push(h.maxInterSentenceMs);
      prev = h.text;
    }
  });
  const r = (a, b) => (b ? +(a / b).toFixed(4) : 0);
  return {
    calls: m.calls, turns: m.turns, heardTurns: m.heardTurns, silentTurns: m.silentTurns, sentences: m.sentences,
    repeatedTurns: m.repeatedTurns, repeatedSentenceRate: r(m.repeatedSentences, m.sentences),
    ackLedRate: r(m.ackLed, m.heardTurns), consecutiveAck: m.consecutiveAck, fillerOnlyTurns: m.fillerOnlyTurns,
    fragments: m.fragments, fragmentSamples: m.fragmentSamples,
    langTurns: m.langTurns, langMatch: m.langTurns ? r(m.langTurns - m.langMismatch, m.langTurns) : null, langSamples: m.langSamples,
    toolTurns: m.toolTurns, firstSentenceMsP95: pct(m.firstMs, 95), toolTurnFirstSentenceMsP95: pct(m.toolFirstMs, 95),
    postToolGapMsP95: pct(m.postToolMs, 95), interSentenceGapMsP95: pct(m.interMs, 95),
  };
}
module.exports = { scoreHeard, heardTurn, isFragment, FILLER };
