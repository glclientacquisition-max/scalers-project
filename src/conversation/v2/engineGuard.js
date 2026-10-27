'use strict';
// Guard for BRAIN_ENGINES model sentences: pass, ONE repair (a fact-correct fix of the same sentence), or drop.
// Never swaps in a canned/template line: callPlan 'replace' verdicts (off_step, readback_mismatch) become drops
// on the engines path. A model sentence that tries to read back or confirm is dropped (the read-back is the
// fixed template; a mismatch is never spoken and never passes through to a save).
// Grounding: every clock time in a model sentence must come from this turn's receipts or the call's slots.
const ML = require('./modelLead');
const CP = require('./callPlan');

const READBACK_LIKE = /\b(shall i (?:book|go ahead|ask|place|confirm)|nithibitishe|niendelee\?|nimwombe .*ni sawa|ni sawa\?$|is that (?:right|correct)\?)\b/i;
const CLOCK_EN = /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;

function toHHMM(h, m, ap) {
  let hh = Number(h);
  const a = String(ap || '').toLowerCase().replace(/\./g, '');
  if (a === 'pm' && hh < 12) hh += 12;
  if (a === 'am' && hh === 12) hh = 0;
  return `${String(hh).padStart(2, '0')}:${String(Number(m || 0)).padStart(2, '0')}`;
}
function timesIn(s) {
  const out = [];
  for (const m of String(s || '').matchAll(CLOCK_EN)) {
    if (m[1] != null) out.push(toHHMM(m[1], m[2], m[3]));
    else out.push(toHHMM(m[4], m[5], null));
  }
  return out;
}
/** Allowed times: every HH:MM / h am|pm in the receipts, the profile hours and the call's slots. */
function allowedTimes({ receipts = [], machine = {}, profile = {}, extra = [] } = {}) {
  const set = new Set();
  const add = (t) => { for (const x of timesIn(t)) set.add(x); };
  for (const r of receipts) add(r && (r.text || r.line_en || r.line_sw || ''));
  const days = profile.hoursSchedule?.days || {};
  for (const d of Object.values(days)) { if (d && d.open) set.add(d.open); if (d && d.close) set.add(d.close); }
  const w = machine.slots?.when; if (w && w.time) set.add(w.time);
  for (const x of extra) if (x) set.add(x);
  return set;
}

function makeEnginesVerifier(ctx, { allowed = null, readbackTurn = false } = {}) {
  const base = ML.makeVerifier(ctx);
  const origCheck = base.check.bind(base);
  const times = allowed || allowedTimes({ receipts: ctx.receiptsForTimes || [], machine: ctx.machine, profile: ctx.profile });
  base.check = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return { verdict: 'drop', reason: 'empty' };
    if (READBACK_LIKE.test(s)) return { verdict: 'drop', reason: readbackTurn ? 'readback_mismatch_model' : 'model_readback' };
    const bad = timesIn(s).filter((t) => !times.has(t));
    if (bad.length) return { verdict: 'drop', reason: `time_not_in_receipts:${bad[0]}` };
    const v = origCheck(s);
    if (v.verdict === 'replace') {
      // engines: never swap a template in; a real fact fix of the same sentence is the one allowed repair
      if (v.fix) return { verdict: 'repair', text: v.fix, reason: v.reason };
      return { verdict: 'drop', reason: v.reason };
    }
    return v;
  };
  return base;
}

/** Engines never use callPlan replace verdicts. */
function actCheckEngines(text, st, ctx) {
  const g = CP.actCheck(text, st, ctx);
  if (g.verdict === 'replace') return { verdict: 'drop', reason: g.reason };
  return g;
}

module.exports = { makeEnginesVerifier, actCheckEngines, timesIn, allowedTimes, READBACK_LIKE };
