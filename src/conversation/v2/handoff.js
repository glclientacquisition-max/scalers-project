'use strict';
// ENGINE 3: one handoff path (callback / take message) per call.
const CS = require('./commitSafety');
const L = require('./lexicon');
const CP = require('./callPlan');

const REASONS = new Set(['closed', 'area_unknown', 'area_outside', 'service_out', 'wants_human', 'stuck', 'caller_callback']);

function initHandoff(state) {
  if (!state.handoff) state.handoff = { phase: 'idle', reason: null, committed: false, idempotencyKey: null };
  return state.handoff;
}

function shouldHandoff({ understanding, machine, profile, now = new Date() }) {
  const u = understanding || {};
  if (u.wants_human) return { reason: 'wants_human' };
  if (u.intent === 'callback' || u.intent === 'handoff') return { reason: 'caller_callback' };
  const days = profile.hoursSchedule?.days;
  if (days) {
    const p = L.eatParts(now);
    const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][p.dow];
    const today = days[key];
    const hhmm = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
    const open = today && !today.closed && today.open && today.close && hhmm >= today.open && hhmm < today.close;
    if (!open && profile.afterHoursMode !== 'serve') return { reason: 'closed' };
    if (!open && profile.afterHoursMode === 'serve' && machine._enginesDateAsks >= 1) return { reason: 'closed' };
  }
  if (machine._enginesStuck) return { reason: 'stuck' };
  const place = u.slots?.place || machine.slots?.place;
  if (place) {
    const AC = require('./areaCoverage');
    const r = AC.resolve(place, profile);
    if (r?.status === 'unknown') return { reason: 'area_unknown' };
    if (r?.status === 'outside') return { reason: 'area_outside' };
  }
  return null;
}

function readbackLine({ machine, profile, lang, callerPhone }) {
  const name = CP.lockedName(machine) || machine.slots?.name || null;
  const phone = CS.sayPhone(callerPhone || machine.callerPhone);
  const when = CS.callbackWhen({ profile, now: new Date(), L });
  const sayWhen = when.say(lang);
  if (lang === 'sw') {
    return `[PROMPT-PLACEHOLDER] Nimwombe mwenye biashara akupigie${name ? `, ${name}` : ''}, kwa ${phone || 'nambari yako'}, ${sayWhen}. Ni sawa?`;
  }
  return `[PROMPT-PLACEHOLDER] Shall I ask the owner to call you back${name ? `, ${name}` : ''} on ${phone || 'your number'}, ${sayWhen}?`;
}

function stepHandoff({ machine, understanding, profile, lang, callerPhone }) {
  const h = initHandoff(machine);
  const trigger = shouldHandoff({ understanding, machine, profile });
  if (h.phase === 'idle' && trigger) {
    h.reason = trigger.reason;
    h.phase = CP.lockedName(machine) ? 'confirm_phone' : 'ask_name';
    if (!REASONS.has(h.reason)) h.reason = 'caller_callback';
  }
  if (h.phase === 'idle') return null;
  if (h.committed) return { kind: 'done', line: null };
  if (understanding?.yes_no === 'yes' && h.phase === 'confirm_yes') {
    return { kind: 'commit', line: null };
  }
  if (understanding?.yes_no === 'no' && h.phase === 'confirm_yes') {
    h.phase = 'explain';
    return { kind: 'explain', line: lang === 'sw' ? '[PROMPT-PLACEHOLDER] Sawa. Ungependa tuachane na hilo?' : '[PROMPT-PLACEHOLDER] Okay. Should we leave it there?' };
  }
  if (h.phase === 'ask_name') {
    if (understanding?.slots?.name) {
      bindCallerName(machine, null, understanding.slots.name);
      h.phase = 'confirm_phone';
    } else {
      return { kind: 'ask_name', line: lang === 'sw' ? '[PROMPT-PLACEHOLDER] Naomba jina lako kwanza.' : '[PROMPT-PLACEHOLDER] May I have your name first?' };
    }
  }
  if (h.phase === 'confirm_phone') {
    const line = readbackLine({ machine, profile, lang, callerPhone });
    h.phase = 'confirm_yes';
    return { kind: 'readback', line };
  }
  if (h.phase === 'confirm_yes' && understanding?.yes_no !== 'yes') {
    const line = readbackLine({ machine, profile, lang, callerPhone });
    return { kind: 'readback', line };
  }
  return null;
}

function bindCallerName(machine, handlers, name) {
  if (!name) return;
  machine.slots = machine.slots || {};
  machine.slots.name = String(name).trim();
  machine.slots.nameCandidate = machine.slots.name;
  machine.slots.nameConfirmed = true;
  if (handlers?.confirmCallerName) {
    try { handlers.confirmCallerName({ name: machine.slots.name, source: 'handoff' }); } catch { /* best-effort */ }
  }
}

async function commitHandoff({ machine, profile, handlers, callerPhone, understanding, notify } = {}) {
  const h = initHandoff(machine);
  if (h.committed) return { ok: true, duplicate: true, notified: !!h.notifySent };
  const key = h.idempotencyKey || `handoff:${machine.callId || 'call'}:${h.reason || 'callback'}`;
  h.idempotencyKey = key;
  const name = CP.lockedName(machine) || machine.slots?.name || understanding?.slots?.name || '';
  bindCallerName(machine, handlers, name);
  const when = CS.callbackWhen({ profile, now: new Date(), L });
  const pending = {
    tool: 'create_handoff',
    kind: 'callback',
    reason: h.reason || 'callback',
    phone: callerPhone || machine.callerPhone,
    name,
    callbackWhen: when,
    token: `cb_${machine.turn}`,
    idemKey: key,
    issuedTurn: machine.turn,
  };
  machine.pending = pending;
  machine.phase = 'readback';
  let ok = false;
  let id = null;
  try {
    if (handlers?.createServiceRequest) {
      const r = await handlers.createServiceRequest({ type: 'callback', name, notes: `Handoff: ${h.reason}`, phone: pending.phone });
      ok = !!(r && r.ok);
      id = r?.id || null;
    } else if (handlers?.escalate) {
      const r = await handlers.escalate({ reason: h.reason, name, phone: pending.phone });
      ok = !!(r && r.ok);
      id = r?.id || null;
    }
  } catch { ok = false; }
  machine.receipts = machine.receipts || [];
  machine.receipts.push({ tool: 'create_handoff', ok, id, reason: h.reason, idempotencyKey: key });
  machine.pending = null;
  machine.phase = 'collect';
  h.committed = true;
  h.phase = 'done';
  let notified = !!h.notifySent;
  if (typeof notify === 'function' && ok && !h.notifySent) {
    try {
      const nr = await notify({ reason: h.reason, name, phone: pending.phone, profile, machine });
      notified = !!(nr && (nr.ok || nr.duplicate));
    } catch { notified = false; }
  }
  return { ok, id, duplicate: false, notified };
}

module.exports = {
  initHandoff,
  shouldHandoff,
  stepHandoff,
  commitHandoff,
  readbackLine,
  bindCallerName,
};
