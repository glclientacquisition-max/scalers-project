'use strict';
// B1 safe mode: the emergency capture-only call (plan §2d). Off unless brainMode() says 'safe' for this business
// (tenants.brain_mode = 'safe', or BRAIN_SAFE_MODE = 'all'). Same three engines and the same write plumbing:
//   understanding (typed turn; rules when the model is off) -> SAFE PLAN (this file: one goal) -> tools (no catalogue,
//   prices, areas, hours or bookings: one safe_mode receipt) -> response engine writes every line except the
//   read-back and the outcome line -> commit gate (engineCommit: the callback is confirmed only after the save
//   returned a row id; the owner alert goes after the save).
// Script: greet (the call opening) -> name -> number (caller ID, asked only when withheld) -> reason (free text)
//   -> read all three back -> yes (one correction loop) -> save the callback request + owner alert -> close.
const CS = require('./commitSafety');
const { missingSlots, callerName, plausibleName } = require('./enginePreconditions');
const { pendingAnswer, applySlots } = require('./enginePlan');
const { engState } = require('./engineCommit');

const sw = (lang) => /^sw/i.test(String(lang || ''));
const ACK = /^\W*(ok(?:ay)?|sawa|haya|poa|yes|yeah|yep|no|nope|ndio|ndiyo|hapana|eeh|sure|thanks?|thank you|asante(?: sana)?|alright|hello|hi|hallo|habari|jambo|sasa|mambo|hey)\W*$/i;
const GREET_LEAD = /^\W*(?:(?:hi|hello|hey|hallo|habari|jambo|sasa|mambo|good (?:morning|afternoon|evening)|yes|ok(?:ay)?|sawa)\b[\s,.!-]*)+/i;
const WANT_LEAD = /^\W*(?:i (?:just )?(?:wanted|want|would like|was calling|am calling|'m calling) (?:to (?:ask|know|find out|check) (?:about|if|whether)?|about)?|i'?m calling (?:about|to ask about)?|nilikuwa nataka kujua|nataka kujua|nilitaka kuuliza|nataka kuuliza|ningependa kujua)\s*(?:to\s+)?/i;
const KE_PHONE = /(?:\+?254|0)[\s-]?[17](?:[\s-]?\d){8}/;

function safeState(machine) {
  if (!machine.safe) machine.safe = { reason: null, phone: null, expect: null, corrections: 0, done: false, asks: {} };
  return machine.safe;
}
/** The caller's number for the request: caller ID, else the number they said on this call. */
function phoneOf(machine, callerPhone) {
  // a number the caller said on this call (withheld ID, or a correction) wins over the caller ID
  return (machine.safe && machine.safe.phone) || callerPhone || machine.callerPhone || null;
}
function normPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^254[17]\d{8}$/.test(d)) return `+${d}`;
  if (/^0[17]\d{8}$/.test(d)) return `+254${d.slice(1)}`;
  return null;
}
/** The reason in the caller's words, trimmed for the read-back (no greeting, no "I wanted to ask"). */
function cleanReason(text) {
  let t = String(text || '').replace(KE_PHONE, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(GREET_LEAD, '').replace(WANT_LEAD, '').replace(/^[\s,.!-]+/, '').replace(/^(?:about|kuhusu)\s+/i, '').replace(/[\s?.!,]+$/, '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 && !(words.length === 1 && words[0].length >= 4)) return null;
  return words.slice(0, 14).join(' ').replace(/^./, (c) => c.toLowerCase());
}

/** The callback proposal read back and saved. reason = the caller's words. */
function safeProposal(machine, profile, callerPhone) {
  const S = safeState(machine);
  const phone = phoneOf(machine, callerPhone);
  const p = {
    tool: 'create_handoff', kind: 'callback', reason: 'safe_mode', safe: true,
    name: callerName(machine), phone, phoneSaid: CS.sayPhone(phone), topic: S.reason || null,
    notes: `Safe mode callback: ${S.reason || 'caller asked to be called back'}.`,
    alertReason: S.reason ? `Call back: ${S.reason}` : 'Call back (safe mode)',
    issuedTurn: machine.turn,
  };
  p.token = `sf_${machine.turn}`;
  p.idemKey = CS.idempotencyKey({ callId: machine.callId || 'nocall', p });
  return p;
}

/** The fixed read-back (one of the two fixed lines): name, number and reason, then the yes / no question. */
function readbackLine(p, lang) {
  const num = p.phoneSaid || (sw(lang) ? 'namba hii' : 'this number');
  const about = p.topic ? (sw(lang) ? ` kuhusu ${p.topic}` : ` about ${p.topic}`) : '';
  return sw(lang)
    ? `${p.name}, nimwombe mwenye biashara akupigie kwa namba ${num}${about}. Ni sawa?`
    : `${p.name}, shall I ask the team to call you back on ${num}${about}?`;
}

const OFF_TOPICS = new Set(['services', 'price', 'hours', 'coverage', 'payment']);
/** The one receipt a safe-mode turn may carry: no catalogue, prices, areas, hours or bookings. */
function safeReceipt(u, text, lang) {
  const a = u.answers || [];
  const asked = a.some((x) => OFF_TOPICS.has(x)) || u.intent === 'book' || (u.slots && (u.slots.service || u.slots.place || u.slots.day || u.slots.time));
  if (!asked && !/\?/.test(String(text || ''))) return null;
  return {
    tool: 'safe_mode', ok: true, kind: 'team_callback',
    // never a callback claim before the save (engineCommit commit truth): "can follow up", not "will call you"
    text: sw(lang) ? 'Siwezi kujibu hilo kwenye simu hii, lakini mwenye biashara atalifuatilia.' : "I can't answer that on this call, but the team can follow up on it.",
    rule: 'no catalogue, prices, areas, hours or bookings in safe mode; do not say any number or time',
  };
}

/**
 * The safe plan: exactly one goal. Goals: commit | readback | reask | ask(name|phone|reason|change) | answer | close.
 * Reuses the full plan's read-back classifier (pendingAnswer) and the slot table (enginePreconditions).
 */
function pickSafeGoal({ understanding, machine, profile = {}, callerPhone, now = new Date(), text = '' }) {
  const E = engState(machine);
  const S = safeState(machine);
  const u = understanding || {};
  // never a booking in safe mode: only the name is taken from the typed slots
  applySlots(machine, { ...u, intent: u.intent === 'book' ? 'ask' : u.intent, slots: { name: u.slots && u.slots.name } }, profile, { text, now });
  machine.intent = null;
  const t = String(text || '').trim();
  // a number the caller says (withheld caller ID, or a correction)
  const pm = t.match(KE_PHONE); const said = pm ? normPhone(pm[0]) : null;
  const E0 = machine.eng || {};
  if (said && (!phoneOf(machine, callerPhone) || S.expect === 'phone' || S.expect === 'change' || (E0.pending && E0.pending.p && E0.pending.p.safe))) S.phone = said;
  // a name said as the answer to "your name?" (rules understanding gives no name slot for a bare "Wanjiru")
  if (S.expect === 'name' && !callerName(machine) && !said) {
    const bare = t.replace(/^(?:it'?s|my name is|i'?m|this is|naitwa|jina langu ni|ni)\s+/i, '').replace(/[.!?,]+$/, '').trim();
    if (bare && bare.split(/\s+/).length <= 3 && plausibleName(bare, profile)) { machine.slots.nameCandidate = bare.replace(/\b[a-z]/g, (c) => c.toUpperCase()); }
  }
  // the reason: the first substantive thing the caller says that is not a name / number answer
  if (!S.reason || S.expect === 'reason' || (S.expect === 'change' && !said && !(u.slots && u.slots.name))) {
    const answeringSlot = (S.expect === 'name' || S.expect === 'phone') && (callerName(machine) || said);
    if (!answeringSlot && !ACK.test(t) && !u.closing) { const r = cleanReason(t); if (r && (S.expect === 'reason' || S.expect === 'change' || !S.reason)) S.reason = r; }
  }

  if (S.done) {
    S.expect = null;
    if (u.closing || u.yes_no === 'no' || ACK.test(t)) return { type: 'close', answers: [] };
    return { type: 'answer', topics: ['safe'], answers: ['safe'], offerCallback: false };
  }
  // 1) the pending read-back is answered first
  if (E.pending && E.pending.p && E.pending.p.safe) {
    const p = E.pending.p;
    const a = pendingAnswer(p, u, text, { profile, now });
    E.pending.lastAnswer = a;
    if (a === 'yes') { S.expect = null; return { type: 'commit', p, answers: [] }; }
    if (a === 'unclear' && (E.pending.reasks || 0) < 1) { E.pending.reasks = (E.pending.reasks || 0) + 1; return { type: 'reask', p, answers: [] }; }
    E.pending = null;
    if (a === 'no' && (said || (u.slots && u.slots.name))) { S.corrections += 1; return { type: 'readback', p: safeProposal(machine, profile, callerPhone), corrected: true, answers: [] }; }
    if (a === 'change') { S.corrections += 1; return { type: 'readback', p: safeProposal(machine, profile, callerPhone), corrected: true, answers: [] }; }
    // a no (or still unclear): one correction loop, then a polite close with nothing saved
    if (S.corrections >= 1) { S.expect = null; return { type: 'close', answers: [], unsaved: true }; }
    S.corrections += 1; S.expect = 'change';
    return { type: 'ask', slot: 'change', why: 'callback', answers: [] };
  }
  // a correction answered: read back again with what changed
  if (S.expect === 'change') { S.expect = null; return { type: 'readback', p: safeProposal(machine, profile, callerPhone), corrected: true, answers: [] }; }
  if (u.closing && !callerName(machine) && !S.reason) return { type: 'close', answers: [] };
  // 2) the next missing slot: name, number (only when the caller ID is withheld), reason
  const miss = missingSlots('create_handoff', machine, { profile, callerPhone: phoneOf(machine, callerPhone) });
  if (!S.reason && !miss.includes('name') && !miss.includes('phone')) miss.push('reason');
  const order = ['name', 'phone', 'reason'];
  const next = order.find((s) => miss.includes(s));
  if (next) {
    const asked = S.asks[next] || 0;
    if (next === 'name' && asked >= 2) { S.expect = null; return { type: 'no_name', answers: [] }; }
    S.asks[next] = asked + 1; S.expect = next;
    return { type: 'ask', slot: next, n: asked, why: 'callback', answers: (u.answers || []).length ? ['safe'] : [] };
  }
  // 3) everything taken: the read-back
  S.expect = null;
  return { type: 'readback', p: safeProposal(machine, profile, callerPhone), answers: [] };
}

module.exports = { pickSafeGoal, safeProposal, readbackLine, safeReceipt, safeState, cleanReason, normPhone, phoneOf, KE_PHONE };
