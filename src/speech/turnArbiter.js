'use strict';
// VOICE_TURN_ARBITER (default off). The single speak decision for a caller turn.
//
// Every mouth (v2 catalogueStep, Brain localReply, legacy catalogueMouth /
// shapeCatalogueMouth, name-yes closer, service_facts / grounded price, live
// Gemini) submits a Proposal. speak(proposals) picks exactly one and seals it
// as an immutable SpeakPacket; every other proposal is traced as rejected.
// speakText() asks admit() before any TTS, so on a claimed turn nothing outside
// the sealed packet reaches the speaker (fillers / idle nudges / replays are
// prosody, not content, and stay allowed). Polish may change prosody only:
// polishPacketLine() keeps the sealed text when a rewrite changes its words.
//
// Topic lock {topic, step, docVersion, ttl, openQuestion, lang} lives in call
// state, survives barge-in and backchannels ("Karibu", "Yeah", "Sawa"), and
// suppresses live Gemini while a catalogue packet is locked.

const PRIORITY = {
  name_yes_closer: 100,
  v2_catalogue: 90,
  topic_hold: 85,
  grounded_price: 80,
  service_facts: 80,
  local_catalogue: 70,
  legacy_catalogue: 60,
  gemini: 10,
};
const LOCK_TTL = 3;
// Backchannels / barge fragments that keep the topic. Not thank-you: a thank-you closes the call (HD_89 rule).
const BC_TOKENS = 'karibu|yeah|ok(?:ay)?|sawa basi|sawa|eeh?|ehe|mm+|hmm+|mhm|m-hm|aha|uh+|um+|oh|ah|i see|poa|fine|naam|haya|nakusikia|nimekusikia|nisikize|niulize|go on|endelea';
const BACKCHANNEL = new RegExp(`^\\W*(?:(?:${BC_TOKENS})[\\s.,!?]*){1,3}$`, 'i');
// Yes-words are a backchannel only when the open question is not a yes/no question.
const YES_TOKENS = 'yes|yeah yes|ndio|ndiyo|sure|right';
const YES_ONLY = new RegExp(`^\\W*(?:(?:${YES_TOKENS}|${BC_TOKENS})[\\s.,!?]*){1,3}$`, 'i');
const HELLO = /^\W*(?:(?:hello|halo|hallo|haloo)[\s.,!?]*){1,3}$/i;
const YES_NO_Q = /^(je,?\s+)?(is|are|do|does|did|can|could|would|will|shall|should|am|have|has|unataka|ungependa\s+ni|naongea|uko|una|ni\s+wewe)\b|\b(or not|au la|sivyo)\b/i;

function turnArbiterEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.VOICE_TURN_ARBITER || ''));
}
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }

function isYesNoQuestion(q) { return YES_NO_Q.test(norm(q)); }
function isBackchannel(text, { openQuestion = '' } = {}) {
  const t = norm(text);
  if (!t) return true;
  if (BACKCHANNEL.test(t)) return true;
  return YES_ONLY.test(t) && Boolean(openQuestion) && !isYesNoQuestion(openQuestion);
}
const isHello = (text) => HELLO.test(norm(text));

function createTurnArbiter({ enabled = turnArbiterEnabled(), trace = () => {}, state = null } = {}) {
  const holder = state || {};
  let turn = 0;
  let sealed = null; // SpeakPacket of the current turn
  let rejected = [];
  const spokenThisTurn = [];

  function lock() { return holder.turnLock || null; }
  function setLock(l) { holder.turnLock = l ? { ...l } : null; }

  function beginTurn(text = '') {
    turn += 1; sealed = null; rejected = []; spokenThisTurn.length = 0;
    const l = lock();
    if (l) {
      // Barge-in fragments and backchannels keep the topic; other turns age it.
      if (!isBackchannel(text, l) && !isHello(text)) l.ttl -= 1;
      if (l.ttl <= 0) { trace({ kind: 'topic_unlock', topic: l.topic, reason: 'ttl' }); setLock(null); }
    }
    return turn;
  }

  // proposals: [{source, line|lines, topic?, grounded?, facts?, lock?}]
  function speak(proposals = []) {
    if (!enabled) return null;
    const live = proposals.filter((p) => p && (norm(p.line) || (p.lines || []).some(norm)));
    const ranked = [...live].sort((a, b) => (PRIORITY[b.source] || 0) - (PRIORITY[a.source] || 0));
    const win = ranked[0] || null;
    rejected = ranked.slice(1).map((p) => ({ source: p.source, line: norm(p.line || (p.lines || []).join(' ')), reason: win ? `lost_to:${win.source}` : 'empty' }));
    for (const r of rejected) trace({ kind: 'proposal_rejected', turn, ...r });
    if (!win) return null;
    const lines = (win.lines || [win.line]).map(norm).filter(Boolean);
    sealed = deepFreeze({ turn, source: win.source, topic: win.topic || null, lines, grounded: win.grounded !== false, facts: win.facts || null });
    trace({ kind: 'speak_packet', turn, source: sealed.source, topic: sealed.topic, lines: sealed.lines, rejected: rejected.length });
    if (win.lock) setLock({ ttl: LOCK_TTL, ...win.lock, lines });
    else if (win.topic === 'catalogue' && lock()) { lock().ttl = LOCK_TTL; lock().lines = [...new Set([...(lock().lines || []), ...lines])]; }
    return sealed;
  }

  // Gate for every TTS call. Prosody classes always pass.
  function admit(text, opts = {}) {
    if (!enabled) return { ok: true };
    if (opts.isReplay) {
      // A hear-again replay inside a locked topic may only replay that topic's packet.
      const l = lock();
      if (l && Array.isArray(l.lines) && !l.lines.includes(norm(text))) {
        trace({ kind: 'tts_refused', turn, source: 'replay', line: norm(text), owner: `lock:${l.topic}` });
        return { ok: false, reason: `topic_locked:${l.topic}` };
      }
      return { ok: true, prosody: true };
    }
    if (opts.isFiller || opts.isIdleNudge) return { ok: true, prosody: true };
    if (!sealed) return { ok: true };
    const t = norm(text);
    if (sealed.lines.includes(t) || (opts.packetLine && sealed.lines.includes(norm(opts.packetLine)))) { spokenThisTurn.push(t); return { ok: true }; }
    trace({ kind: 'tts_refused', turn, source: opts.tracePath || 'unknown', line: t, owner: sealed.source });
    return { ok: false, reason: `turn_owned_by:${sealed.source}` };
  }

  // Live Gemini may run only on an unclaimed turn with no locked catalogue packet.
  function geminiAllowed() {
    if (!enabled) return true;
    if (sealed) { trace({ kind: 'proposal_rejected', turn, source: 'gemini', reason: `lost_to:${sealed.source}` }); return false; }
    return true;
  }

  // Claimed packet fully played: later async speech (next turn, replays) is not judged against it.
  function release() { if (sealed) trace({ kind: 'packet_released', turn, source: sealed.source }); sealed = null; }
  // A turn-structural line composed with the packet (the file name ask) joins it, traced.
  function extend(line, reason) {
    if (!sealed || !norm(line) || sealed.lines.includes(norm(line))) return sealed;
    sealed = deepFreeze({ ...sealed, lines: [...sealed.lines, norm(line)], extended: reason || 'extend' });
    if (lock()) lock().lines = [...(lock().lines || []), norm(line)];
    trace({ kind: 'packet_extended', turn, source: sealed.source, reason, line: norm(line) });
    return sealed;
  }
  // Gemini on an unclaimed turn: item names checked against the pinned doc.
  // Uses Brain's itemNamePostCheck (src/conversation/v2/topic.js, #707); absent -> no check.
  function geminiLineOk(line, doc) {
    if (!enabled || !doc || !norm(line)) return true;
    let check = null;
    try { check = require('../conversation/v2/topic').itemNamePostCheck; } catch { return true; }
    if (typeof check !== 'function') return true;
    const r = check(line, doc) || { ok: true };
    if (!r.ok) trace({ kind: 'proposal_rejected', turn, source: 'gemini', reason: 'item_name_post_check', offending: r.offending || [], line: norm(line) });
    return r.ok !== false;
  }
  return {
    enabled, release, extend, geminiLineOk,
    beginTurn, speak, admit, geminiAllowed,
    claimed: () => Boolean(sealed),
    packet: () => sealed,
    rejected: () => rejected.slice(),
    lock, setLock,
  };
}

// Polish on a sealed line may change prosody (punctuation, spacing, case) only.
function polishPacketLine(line, polish) {
  const out = typeof polish === 'function' ? polish(line) : line;
  const same = words(out).join(' ') === words(line).join(' ');
  return same && norm(out) ? out : line;
}

module.exports = { turnArbiterEnabled, createTurnArbiter, polishPacketLine, isBackchannel, isHello, isYesNoQuestion, PRIORITY, LOCK_TTL };
