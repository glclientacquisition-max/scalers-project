'use strict';
// Call plan goals for BRAIN_ENGINES: understanding + state -> one next goal.
const CP = require('./callPlan');
const L = require('./lexicon');
const { shouldHandoff, stepHandoff } = require('./handoff');
function businessOpen(profile, now = new Date()) {
  const days = profile.hoursSchedule?.days;
  if (!days) return true;
  const p = L.eatParts(now);
  const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][p.dow];
  const today = days[key];
  const hhmm = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  return !!(today && !today.closed && today.open && today.close && hhmm >= today.open && hhmm < today.close);
}

function applySlots(machine, u, profile) {
  if (!u?.slots) return;
  machine.slots = machine.slots || { when: { date: null, time: null } };
  if (u.slots.service) machine.slots.service = u.slots.service;
  if (u.slots.place) machine.slots.place = u.slots.place;
  if (u.slots.day) machine.slots.when = { ...(machine.slots.when || {}), date: u.slots.day };
  if (u.slots.time) machine.slots.when = { ...(machine.slots.when || {}), time: u.slots.time };
  if (u.slots.name && !CP.lockedName(machine)) machine.slots.nameCandidate = u.slots.name;
  if (u.intent === 'book') machine.intent = 'book';
  if (u.language === 'sw' || u.language === 'en') machine.lang = u.language;
}

function pickGoal({ understanding, machine, profile, lang, callerPhone, now = new Date() }) {
  applySlots(machine, understanding, profile);
  const open = businessOpen(profile, now);
  const u = understanding || {};
  if (!open && profile.afterHoursMode !== 'serve' && u.intent === 'book') {
    machine._enginesDateAsks = (machine._enginesDateAsks || 0) + 1;
  }
  if (!open && machine._enginesOfferCallback) {
    stepHandoff({ machine, understanding: { ...u, intent: 'callback' }, profile, lang, callerPhone });
  }
  const trig = shouldHandoff({ understanding, machine, profile, now });
  if (trig && (!machine.handoff?.phase || machine.handoff.phase === 'idle')) {
    stepHandoff({ machine, understanding, profile, lang, callerPhone });
  }
  const handoffStep = stepHandoff({ machine, understanding, profile, lang, callerPhone });
  if (handoffStep?.kind === 'commit') return { type: 'handoff_commit' };
  if (handoffStep && handoffStep.kind !== 'done') {
    return { type: 'handoff', step: handoffStep };
  }
  if (!open && (machine._enginesDateAsks || 0) >= 1 && u.intent === 'book') {
    stepHandoff({ machine, understanding: { ...u, intent: 'callback' }, profile, lang, callerPhone });
    const hs = stepHandoff({ machine, understanding, profile, lang, callerPhone });
    if (hs) return { type: 'handoff', step: hs };
  }
  if (u.yes_no === 'yes' && machine.phase === 'readback' && machine.pending?.tool === 'create_booking') {
    return { type: 'book_commit' };
  }
  if (machine.intent === 'book') {
    const missing = [];
    if (!machine.slots?.service) missing.push('service');
    else if (!machine.slots?.when?.date) missing.push('date');
    else if (!machine.slots?.when?.time) missing.push('time');
    else if (!machine.slots?.place) missing.push('place');
    else if (!CP.lockedName(machine)) missing.push('name');
    else return { type: 'readback' };
    if (missing[0] === 'date') machine._enginesDateAsks = (machine._enginesDateAsks || 0) + 1;
    return { type: 'ask', slot: missing[0] };
  }
  if (u.answers?.length) return { type: 'answer', topics: u.answers };
  return { type: 'open' };
}

module.exports = { pickGoal, applySlots, businessOpen };
