'use strict';
// BRAIN_V2_REPLY_OWNER (default off): one reply owner per turn (fixes 1+2 of voice-qa/2026-10-24_10f115ac-dials.md).
// 1) The turn is classified against the open question: answer / check_or_correct / new_ask / filler.
// 2) Checks and corrections ("what have you said my name is?", "carpet cleaning, right?") are answered from
//    state, never treated as slot fills; the open question is then asked once.
// 3) A new ask mid-booking about another service is answered (explain / offered fact) without replacing the
//    booking's service; the service changes only on an explicit switch.
// 4) Per-turn language: follow the caller's clear switch even when Voice passed a call-level lock.
// 5) The same open question asked again with no slot progress counts toward the callback offer.
// 6) Names bind only from an answer to our name question; presence / filler words are never names.
// The model never speaks: its fields only add the check_or_correct_detail act. New lines: [PROMPT-PLACEHOLDER].
const L = require('./lexicon');
const R = require('./receipts');

const enabled = () => process.env.BRAIN_V2_REPLY_OWNER === 'on';
const SAME_ASK_LIMIT = 2; // repeats of the same open question with no progress before the callback offer

const PRESENCE = /^(nipo|niko|nipo hapa|niko hapa|hapa|nimefika|upo|uko|here|present|yes|yeah|yep|yup|okay|ok|sawa|ndio|ndiyo|eeh|eh|mmh|hmm|hello|halo|hallo|hi|hey|hujambo|sasa|poa|fine|good|alright)$/i;
const NAME_Q = /\b(what|which) name\b|\bname (did|have) you\b|\b(what|which|whose)\b[^?]{0,40}\bmy name\b|\bmy name\b[^?]{0,40}\?|\b(did you|have you) (get|got|say|said|put)\b[^?]{0,20}\bname\b|\bjina langu\b[^?]{0,30}(nini|gani|\?)|\bumesema jina\b/i;
const NAME_FIX = /\b(that'?s not my name|not my name|wrong name|my name is not|my name isn'?t|si jina langu|jina langu si)\b/i;
const RIGHT_Q = /^\W*(.{2,48}?),?\s+(right|correct|isn'?t it|is that right|sio|ama sio|au sio|si ndio)\s*\?\s*$/i;
const SWITCH = /\b(instead|change (it|that|the service|the booking)? ?to|switch (it |that )?to|rather|badala ya|badilisha)\b/i;
const HOW = /\b(what is done|what'?s done|what (do|does) (it|you|that) (include|involve|do)|how (is it|it'?s|it is) done|tell me about|what is it|inafanywa aje|mnafanyaje)\b/i;
const FRAGMENT = /\b(the|a|an|about|and|so|of|to|my|your|kuhusu|na)\W*$/i;

function ro(state) { state.ro = { lastQ: null, qFor: {}, same: 0, fix: null, switchOffer: null, lastHash: null, listedPlace: null, ...(state.ro || {}) }; return state.ro; }
const sentences = (line) => String(line || '').match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) || [];
const said = (line) => sentences(line).find((x) => /\?$/.test(x)) || null; // the open question in a line
// sentences that carry no answer: repair / hold / example / yes-no nudge
const NONINFO = /^(sorry|samahani|take your time|sure, take your time|sawa, chukua|chukua muda|okay\.?$|sawa\.?$|for example|mfano|please say yes or no|tafadhali sema)/i;
const onlyQuestion = (line, q) => sentences(line).every((x) => x === q || NONINFO.test(x));
const NOT_NAME_ANSWER = /^(one|two|three|four|five|six|seven|eight|nine|ten|for|moja|mbili|tatu|nne|tano)$/i;
const slotHash = (state) => JSON.stringify({ s: state.slots?.service || null, w: state.slots?.when || null, p: state.slots?.place || null, n: state.slots?.name || null, i: state.intent || null, ph: state.phase || null, pd: state.pending ? state.pending.slotHash || state.pending.token || 1 : null });
const isSw = (state) => L.isSw(state.lang);

/** Per-turn language: start from Voice's lock or the call language, follow a clear switch in this turn's words. */
function turnLang(prev, langLock, text) {
  const base = (langLock === 'en' || langLock === 'sw') ? langLock : prev;
  return L.nextLanguage(base, text) || base;
}

/** Name binding: true only when this turn answers our own name question. */
function nameBindable(state, text) { if (questionTurn(text)) return false;
  return nameBindable0(state); }
function nameBindable0(state) { return state.expecting === 'name' || (ro(state).fix && ro(state).fix.slot === 'name' && ro(state).fix.stage === 'ask'); }
const presence = (w) => { const x = String(w || '').trim().replace(/[.!?,]+$/, ''); return PRESENCE.test(x) || NOT_NAME_ANSWER.test(x); };
/** A question ("Four?") is never a name answer. */
const questionTurn = (text) => /\?\s*$/.test(String(text || '').trim());

/** answer | check_or_correct | new_ask | filler, against the open question. */
function classifyAct(state, u, text, fields) {
  const t = String(text || '').trim();
  const modelCheck = !!(fields && Array.isArray(fields.asks) && fields.asks.includes('check_or_correct_detail'));
  if (NAME_Q.test(t) || NAME_FIX.test(t) || RIGHT_Q.test(t) || modelCheck) return 'check_or_correct';
  const e = state.expecting;
  const gave = (e === 'date' && (u.when?.date || u.when?.time)) || (e === 'time' && (u.when?.time || u.when?.date)) || (e === 'place' && (u.place || u.area)) || (e === 'name' && (u.name || u.nameCandidate)) || ((e === 'confirm' || state.offer) && (u.yes || u.no));
  if (gave) return 'answer';
  const empty = !(u.intents || []).length && !u.service && !u.place && !u.area && !u.when?.date && !u.when?.time && !u.name && !u.yes && !u.no;
  if (empty && (t.split(/\s+/).length <= 4 || FRAGMENT.test(t))) return 'filler';
  return 'new_ask';
}

/** The open question to resume with (once). */
function openQ(state, deps) {
  const p = state.phase === 'readback' && state.pending;
  if (p) return said(R.readback(p, state.lang)) || said(p.readbackLine);
  const r = ro(state);
  return (state.expecting && r.qFor[state.expecting]) || r.lastQ || null;
}
const done = (state, line, kind) => { state.lastLine = line; state.lastBase = line; state.trace.push({ turn: state.turn, reply_owner: kind }); return { line, lang: state.lang || 'en', source: 'receipt', toolResults: [], end: false }; };
const join = (a, b) => [a, b].filter(Boolean).join(' ');

function rebindName(state, name, deps) {
  state.slots.name = name; state.slots.nameConfirmed = true; state.file = state.file || {}; state.file.nameConfirmed = true;
  if (state.phase === 'readback' && state.pending) return deps.propose(state, { ...state.pending, name });
  return null;
}

/** Owns the turn's reply when the act needs it; null hands the turn back to the machine (fact provider). */
function own(state, u, { text, profile = {}, fields = null, deps }) {
  const r = ro(state); const sw = isSw(state);
  const act = classifyAct(state, u, text, fields);
  u.act = act; r.act = { turn: state.turn, act }; // traced in post(), after the turn's own trace entries
  // an open name fix from a check: this turn answers it
  if (r.fix && r.fix.slot === 'name') {
    const fix = r.fix;
    const nm = questionTurn(text) ? null : u.name || (u.nameCandidate && !presence(u.nameCandidate) ? u.nameCandidate : null);
    if (fix.stage === 'confirm' && u.yes && !u.no) { r.fix = null; const rb = state.phase === 'readback' && state.pending ? deps.propose(state, { ...state.pending }) : null; return done(state, rb || join(sw ? 'Sawa.' : 'Okay.', fix.resume), 'name_kept'); }
    if (nm) { r.fix = null; const rb = rebindName(state, nm, deps); return done(state, rb || join(sw ? `Asante, ${nm}.` : `Thanks, ${nm}.`, fix.resume), 'name_fixed'); }
    if (fix.stage === 'confirm' && u.no) { r.fix = { ...fix, stage: 'ask' }; state.expecting = 'name'; return done(state, sw ? 'Samahani. Naomba jina lako?' /* [PROMPT-PLACEHOLDER] */ : 'Sorry about that. May I have your name?' /* [PROMPT-PLACEHOLDER] */, 'name_ask'); }
    if (fix.tries >= 1) { r.fix = null; if (state.expecting === 'name') state.expecting = state.phase === 'readback' ? 'confirm' : null; }
    else { r.fix = { ...fix, tries: (fix.tries || 0) + 1 }; return done(state, fix.stage === 'ask' ? (sw ? 'Naomba jina lako?' : 'May I have your name?') : (sw ? `Nina jina lako kama ${state.slots.name}. Ni sahihi?` : `I have your name as ${state.slots.name}. Is that right?`), 'name_fix_reask'); }
  }
  // an open "X instead?" from a service check
  if (r.switchOffer) {
    const so = r.switchOffer; r.switchOffer = null;
    if (u.yes && !u.no) { state.slots.service = so.to; state.lastService = so.row || state.lastService; return done(state, join(sw ? 'Sawa.' : 'Okay.', openQ(state, deps)), 'service_switched'); }
    if (u.no) return done(state, join(sw ? 'Sawa.' : 'Okay.', openQ(state, deps)), 'service_kept');
  }
  if (act === 'check_or_correct') {
    const t = String(text || '');
    if (NAME_Q.test(t) || NAME_FIX.test(t) || /\bname|jina\b/i.test(t)) {
      const resume = openQ(state, deps);
      if (NAME_FIX.test(t) && u.name) { const rb = rebindName(state, u.name, deps); return done(state, rb || join(sw ? `Asante, ${u.name}.` : `Thanks, ${u.name}.`, resume), 'name_fixed'); }
      if (state.slots.name) { r.fix = { slot: 'name', stage: NAME_FIX.test(t) ? 'ask' : 'confirm', resume, tries: 0 }; if (NAME_FIX.test(t)) { state.expecting = 'name'; return done(state, sw ? 'Samahani. Naomba jina lako?' /* [PROMPT-PLACEHOLDER] */ : 'Sorry about that. May I have your name?' /* [PROMPT-PLACEHOLDER] */, 'name_ask'); } return done(state, sw ? `Nina jina lako kama ${state.slots.name}. Ni sahihi?` : `I have your name as ${state.slots.name}. Is that right?`, 'name_check'); }
      r.fix = { slot: 'name', stage: 'ask', resume, tries: 0 }; state.expecting = 'name';
      return done(state, sw ? 'Sina jina lako bado. Naomba jina lako?' : "I don't have your name yet. May I have your name?", 'name_check');
    }
    if (u.service) {
      const cur = state.slots?.service || null; const label = deps.label(profile, u.service);
      if (!cur || cur === u.service.name) return done(state, join(sw ? `Ndio, ${label}.` : `Yes, ${label}.` /* [PROMPT-PLACEHOLDER] */, openQ(state, deps)), 'service_confirmed');
      const curLabel = deps.label(profile, { name: cur });
      r.switchOffer = { to: u.service.name, row: u.service };
      return done(state, sw ? `Kwa sasa nina ${curLabel}. Ungependa ${label} badala yake?` /* [PROMPT-PLACEHOLDER] */ : `So far I have ${curLabel}. Would you like ${label} instead?` /* [PROMPT-PLACEHOLDER] */, 'service_check');
    }
    return null; // a check about another detail: the machine's own read-back / slot logic answers it
  }
  // a new ask about another service mid-booking: answer it, keep the booking's service, resume once
  if (act === 'new_ask' && state.intent === 'book' && state.phase === 'collect' && u.service && state.slots?.service && u.service.name !== state.slots.service && !SWITCH.test(String(text || ''))) {
    const t = String(text || ''); const wantsHow = (u.intents || []).includes('explain') || HOW.test(t);
    const fact = wantsHow ? deps.explainLine(profile, u.service) : deps.offeredLine(profile, u.service);
    if (!fact) return null;
    state.lastInfo = wantsHow ? 'explain' : 'price'; // the topic the caller's follow-up reads against (as the machine's info branch sets)
    return done(state, join(fact, openQ(state, deps)), wantsHow ? 'explain_kept_booking' : 'offered_kept_booking');
  }
  return null;
}

/** After the reply: same-question-no-progress escalation, open-question memory. */
function post(state, res, { callbackLine, text = '', possibleRe = null } = {}) {
  if (!res || !res.line) return res;
  const r = ro(state); const h = slotHash(state);
  // "…is it possible?" about the place just chosen: answer it before the next question (existing coverage line)
  if (possibleRe && possibleRe.test(String(text)) && r.listedPlace && state.slots?.place === r.listedPlace && !String(res.line).includes(r.listedPlace + ' is')) {
    const cov = sentences(R.info({ kind: 'coverage', area: { listed: true, name: r.listedPlace } }, state.lang))[0];
    if (cov) { res.line = `${cov} ${res.line}`; state.lastLine = res.line; state.trace.push({ turn: state.turn, reply_owner: 'possible_answered' }); }
  }
  const q = said(res.line);
  const norm = (x) => String(x || '').replace(/\W+/g, ' ').trim().toLowerCase();
  // no progress = the same open question again, nothing answered, no slot changed
  const act = r.act && r.act.turn === state.turn ? r.act.act : null;
  if (act) state.trace.push({ turn: state.turn, turn_act: act });
  // answers are progress even when the slot was already held (HD_4ec "Friday" x4); the read-back has its own confirm rules (R2)
  const repeat = act !== 'answer' && state.phase !== 'readback' && !!(q && r.lastQ && norm(q) === norm(r.lastQ) && h === r.lastHash && onlyQuestion(res.line, q));
  r.same = repeat ? r.same + 1 : 0;
  if (r.same >= SAME_ASK_LIMIT && callbackLine) {
    const sw = isSw(state);
    res.line = sw ? callbackLine.sw : callbackLine.en;
    if (state.pending) { state.record?.('rejected', state.pending, { errorCode: 'no_progress' }); state.pending = null; state.phase = 'collect'; }
    state.expecting = null; state.offer = 'callback'; state.offerService = null; state.lastLine = res.line; state.lastBase = res.line;
    r.same = 0; r.fix = null; r.switchOffer = null;
    state.trace.push({ turn: state.turn, reply_owner: 'same_ask_to_callback' });
  }
  const q2 = said(res.line); if (q2) { r.lastQ = q2; if (state.expecting) r.qFor[state.expecting] = q2; }
  r.lastHash = slotHash(state);
  return res;
}

module.exports = { enabled, turnLang, classifyAct, own, post, nameBindable, presence, PRESENCE, NAME_Q, RIGHT_Q, SAME_ASK_LIMIT };
