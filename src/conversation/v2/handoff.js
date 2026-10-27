'use strict';
// ENGINE 3: one handoff path (callback / take message) per call, BRAIN_ENGINES.
// The plan (enginePlan) drives it: a trigger opens the flow, slot preconditions ask for what is missing
// (name, number), the fixed read-back states number + when in the caller's turn language, and only a yes
// commits through engineCommit (row id + receipt, then owner alert). The clock is always injected.
const CS = require('./commitSafety');
const L = require('./lexicon');
const CP = require('./callPlan');
const { callerName } = require('./enginePreconditions');

const REASONS = new Set(['closed', 'area_unknown', 'area_outside', 'service_out', 'wants_human', 'stuck', 'caller_callback']);

function initHandoff(state) {
  if (!state.handoff) state.handoff = { phase: 'idle', reason: null, committed: false, idempotencyKey: null };
  return state.handoff;
}

function isOpen(profile = {}, now = new Date()) {
  const days = profile.hoursSchedule?.days;
  if (!days) return true;
  const p = L.eatParts(now);
  const today = days[['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][p.dow]];
  const hhmm = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  return !!(today && !today.closed && today.open && today.close && hhmm >= today.open && hhmm < today.close);
}

/** Why this turn should open the handoff flow, or null. Info questions never open it. */
function shouldHandoff({ understanding, machine, profile = {}, now = new Date() }) {
  const u = understanding || {};
  const E = machine.eng || {};
  if (u.wants_human) return { reason: 'wants_human' };
  if (u.intent === 'callback' || u.intent === 'handoff') return { reason: 'caller_callback' };
  if (E.offered === 'callback' && u.yes_no === 'yes') return { reason: 'caller_callback' };
  const booking = u.intent === 'book' || machine.intent === 'book';
  if (booking && !isOpen(profile, now) && profile.afterHoursMode && profile.afterHoursMode !== 'serve') return { reason: 'closed' };
  if (machine._enginesStuck) return { reason: 'stuck' };
  const place = u.slots?.place;
  if (booking && place) {
    const AC = require('./areaCoverage');
    const r = AC.resolve(place, profile);
    if (r?.status === 'outside') return { reason: 'area_outside' };
  }
  return null;
}

/** The create_handoff proposal the caller hears read back (number + when) and says yes to. */
function handoffProposal({ machine, profile = {}, callerPhone, reason, now = new Date() }) {
  const phone = callerPhone || machine.callerPhone || null;
  const r = REASONS.has(reason) ? reason : 'caller_callback';
  const p = {
    tool: 'create_handoff',
    kind: 'callback',
    reason: r,
    phone,
    phoneSaid: CS.sayPhone(phone),
    name: callerName(machine),
    callbackWhen: CS.callbackWhen({ profile, now, L }),
    issuedTurn: machine.turn,
  };
  p.token = `cb_${machine.turn}`;
  p.idemKey = CS.idempotencyKey({ callId: machine.callId || 'nocall', p });
  return p;
}

/** Name used on the read-back is now the caller's; after the yes it is locked (and confirmed in the file). */
function bindCallerName(machine, handlers, name) {
  if (!name) return;
  machine.slots = machine.slots || {};
  machine.slots.name = String(name).trim();
  machine.slots.nameCandidate = machine.slots.name;
  machine.slots.nameConfirmed = true;
  if (handlers?.confirmCallerName) {
    try { const r = handlers.confirmCallerName({ name: machine.slots.name, source: 'readback_yes' }); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* best-effort */ }
  }
}

/** Kept for callers of #966's API: the read-back line for the current handoff, clock injected. */
function readbackLine({ machine, profile, lang, callerPhone, now = new Date(), reason = 'caller_callback' }) {
  const R = require('./receipts');
  return R.readback(handoffProposal({ machine, profile, callerPhone, reason, now }), lang);
}

module.exports = { initHandoff, shouldHandoff, handoffProposal, bindCallerName, readbackLine, isOpen, lockedName: CP.lockedName };
