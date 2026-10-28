'use strict';
// ENGINE 2 (call plan) for BRAIN_ENGINES: understanding + call state -> exactly ONE next goal.
// Goals: commit | readback | reask | ask(slot) | answer | close | no_name | open.
// - A pending read-back is answered first (exact read-back time = yes, a different time = change,
//   unclear = one yes/no re-ask, Alvin's rule; shared classifier commitSafety.readbackAnswer).
// - Every write's required slots come from enginePreconditions; a missing slot is the next ask. No write
//   is ever proposed or attempted with a missing slot.
// - A slot asked twice without progress opens the callback flow (no 4x date ask).
const CP = require('./callPlan');
const CS = require('./commitSafety');
const L = require('./lexicon');
const N = require('./nlu');
const { shouldHandoff, handoffProposal, isOpen } = require('./handoff');
const { missingSlots, callerName } = require('./enginePreconditions');
const { engState } = require('./engineCommit');

const businessOpen = (profile, now = new Date()) => isOpen(profile, now);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;
const CALLBACK_YES = /\b(nipigie|kunipigia|mtanipigia|mnanipigia|unipigie|utamwambia|call me back|call me)\b/i;

/** Normalise model slot words ("tomorrow", "2 PM", "kesho saa nane") to ISO date / HH:MM with the injected clock. */
function normWhen(u, text, now, profile) {
  const day = u?.slots?.day || null; const time = u?.slots?.time || null;
  let date = day && ISO.test(day) ? day : null; let hhmm = time && HHMM.test(time) ? time : null;
  if ((day && !date) || (time && !hhmm)) {
    const w = N.understand(`${day || ''} ${time || ''}`.trim(), { profile, now }).when || {};
    if (!date && w.date) date = w.date;
    if (!hhmm && w.time) hhmm = w.time;
  }
  if (!date || !hhmm) {
    const w = N.understand(String(text || ''), { profile, now }).when || {};
    if (!date && w.date && (day || /\b(today|tomorrow|leo|kesho|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili|\d{1,2}(st|nd|rd|th))\b/i.test(text))) date = w.date;
    if (!hhmm && w.time) hhmm = w.time;
  }
  return { date, time: hhmm };
}

function applySlots(machine, u, profile, { text = '', now = new Date() } = {}) {
  machine.slots = machine.slots || { when: { date: null, time: null } };
  machine.slots.when = machine.slots.when || { date: null, time: null };
  const before = JSON.stringify([machine.slots.service, machine.slots.when, machine.slots.place, callerName(machine)]);
  if (!u) return false;
  const s = u.slots || {};
  if (s.service) {
    const hit = CP.matchServices(s.service, profile)[0];
    machine.slots.service = hit ? hit.name : s.service;
  }
  if (s.place) machine.slots.place = s.place;
  const w = normWhen(u, text, now, profile);
  if (w.date) machine.slots.when = { ...machine.slots.when, date: w.date };
  if (w.time) machine.slots.when = { ...machine.slots.when, time: w.time };
  if (s.name && !CP.lockedName(machine)) machine.slots.nameCandidate = String(s.name).trim();
  if (u.intent === 'book') machine.intent = 'book';
  return before !== JSON.stringify([machine.slots.service, machine.slots.when, machine.slots.place, callerName(machine)]);
}

function bookingProposal(machine, callerPhone) {
  const s = machine.slots;
  const p = { tool: 'create_booking', service: s.service, when: { date: s.when.date, time: s.when.time }, place: s.place, name: callerName(machine), phone: callerPhone || machine.callerPhone || null, issuedTurn: machine.turn };
  p.token = `bk_${machine.turn}`;
  p.idemKey = CS.idempotencyKey({ callId: machine.callId || 'nocall', p });
  return p;
}

/** 'yes' | 'no' | 'change' | 'unclear' for the caller's answer to the pending read-back. */
function pendingAnswer(p, u, text, { profile, now }) {
  const nu = N.understand(String(text || ''), { profile, now });
  const when = nu.when || null;
  const no = u.yes_no === 'no' || !!nu.no;
  const ra = CS.readbackAnswer(p, { text, when, no: false });
  if (ra.kind === 'change') return 'change';
  // a different slot named in the answer is a change, never a yes (service, place, name)
  const s = u.slots || {};
  if (p.tool === 'create_booking') {
    const svc = s.service && CP.matchServices(s.service, profile)[0];
    if ((svc && svc.name !== p.service) || (s.place && String(s.place).toLowerCase() !== String(p.place || '').toLowerCase())) return 'change';
  }
  if (s.name && p.name && String(s.name).toLowerCase() !== String(p.name).toLowerCase()) return 'change';
  if (no) return 'no';
  if (ra.kind === 'yes') return 'yes';
  if (ra.incomplete) return 'unclear';
  if (u.yes_no === 'yes' && u.source === 'model' && !/\b(but|lakini|ila|wait|ngoja|subiri)\b/i.test(text)) return 'yes';
  if (p.tool === 'create_handoff' && CALLBACK_YES.test(text) && !/\b(no|hapana)\b/i.test(text)) return 'yes';
  return 'unclear';
}

function sameProposal(a, b) {
  return !!(a && b && a.tool === b.tool && CS.slotHash(a) === CS.slotHash(b) && String(a.name || '').toLowerCase() === String(b.name || '').toLowerCase());
}

function flowProposal(E, machine, profile, callerPhone, now) {
  if (E.flow.tool === 'create_handoff') return handoffProposal({ machine, profile, callerPhone, reason: E.flow.reason, about: E.flow.about || null, now });
  return bookingProposal(machine, callerPhone);
}

function pickGoal({ understanding, machine, profile = {}, lang, callerPhone, now = new Date(), text = '' }) {
  const E = engState(machine);
  const u = understanding || {};
  applySlots(machine, u, profile, { text, now });
  const answers = Array.isArray(u.answers) ? u.answers : [];

  // 1) the pending read-back is answered first
  if (E.pending) {
    const p = E.pending.p;
    const a = pendingAnswer(p, u, text, { profile, now });
    E.pending.lastAnswer = a;
    if (a === 'yes') {
      // the save must equal what the caller heard: a slot that moved since the read-back blocks it (one corrected read-back)
      const fresh = E.flow ? flowProposal(E, machine, profile, callerPhone, now) : p;
      if (!E.pending.heardOk || !sameProposal(p, { ...fresh, name: fresh.name || p.name })) {
        E.pending = null;
        E.corrected = (E.corrected || 0) + 1;
        return { type: 'readback', p: fresh, corrected: true, answers };
      }
      return { type: 'commit', p, answers };
    }
    if (a === 'change') {
      E.pending = null;
      if (E.flow) {
        const miss = missingSlots(E.flow.tool, machine, { profile, callerPhone });
        if (miss.length) return { type: 'ask', slot: miss[0], why: E.flow.tool === 'create_handoff' ? 'callback' : 'booking', answers };
        return { type: 'readback', p: flowProposal(E, machine, profile, callerPhone, now), answers };
      }
    }
    if (a === 'no') { E.pending = null; E.declined = p.tool; return { type: 'ask', slot: 'change', answers }; }
    if (a === 'unclear') {
      if ((E.pending.reasks || 0) < 1) { E.pending.reasks = (E.pending.reasks || 0) + 1; return { type: 'reask', p, answers }; }
      E.pending = null;
      return { type: 'ask', slot: 'change', answers };
    }
  }

  // 2) open a flow: handoff first (caller asked, wants a person, closed for booking, stuck), else booking
  if (!E.flow || E.flow.done) {
    const trig = shouldHandoff({ understanding: u, machine, profile, now });
    if (trig) E.flow = { tool: 'create_handoff', reason: trig.reason, ...(trig.about ? { about: trig.about } : {}) };
    else if (u.intent === 'book' || machine.intent === 'book') E.flow = { tool: 'create_booking' };
    else E.flow = null;
  } else if (E.flow.tool === 'create_booking') {
    const trig = shouldHandoff({ understanding: { ...u, intent: u.intent === 'book' ? 'book' : u.intent }, machine, profile, now });
    if (trig && trig.reason !== 'closed') E.flow = { tool: 'create_handoff', reason: trig.reason, ...(trig.about ? { about: trig.about } : {}) };
  }
  // the paused item travels with its callback flow (E.flow.about); the offer marker itself is spent
  if (E.flow && E.flow.about) machine.kbWhenBack = null;
  // an offer is answered on the very next turn or not at all (a later, unrelated "yes" never triggers it)
  if (E.offered && (u.yes_no !== null || (E.offeredTurn != null && (machine.turn || 0) > E.offeredTurn + 1))) E.offered = null;

  // 3) the flow's next step: first missing slot, else the read-back
  if (E.flow) {
    const miss = missingSlots(E.flow.tool, machine, { profile, callerPhone });
    if (miss.length) {
      const slot = miss[0];
      if (slot === 'name' && E.lastAsk === 'name' && (u.yes_no === 'no' || /\b(no|hapana|sitaki)\b/i.test(text))) E.nameRefusals = (E.nameRefusals || 0) + 1;
      const asked = E.asks[slot] || 0;
      if (slot === 'name' && ((E.nameRefusals || 0) >= 2 || asked >= 3)) { E.flow = null; E.lastAsk = null; return { type: 'no_name', answers }; }
      // the same booking slot asked twice and still missing: stop asking, offer the owner (never a 4x date ask)
      if (E.flow.tool === 'create_booking' && asked >= 2) {
        E.flow = { tool: 'create_handoff', reason: 'stuck' };
        const m2 = missingSlots('create_handoff', machine, { profile, callerPhone });
        if (m2.length) { E.asks[m2[0]] = (E.asks[m2[0]] || 0) + 1; E.lastAsk = m2[0]; return { type: 'ask', slot: m2[0], n: E.asks[m2[0]] - 1, why: 'callback', answers }; }
        E.lastAsk = null;
        return { type: 'readback', p: flowProposal(E, machine, profile, callerPhone, now), answers };
      }
      E.asks[slot] = asked + 1;
      E.lastAsk = slot;
      return { type: 'ask', slot, n: asked, why: E.flow.tool === 'create_handoff' ? 'callback' : 'booking', answers };
    }
    E.lastAsk = null;
    return { type: 'readback', p: flowProposal(E, machine, profile, callerPhone, now), answers };
  }
  E.lastAsk = null;
  if (u.closing) return { type: 'close', answers };
  if (answers.length) return { type: 'answer', topics: answers, answers, offerCallback: answers.includes('hours') && !businessOpen(profile, now) };
  return { type: 'open', answers };
}

module.exports = { pickGoal, applySlots, businessOpen, pendingAnswer, bookingProposal, normWhen, sameProposal };
