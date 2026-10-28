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
  const kbh = require('../../knowledge/kb/live').handle(ctx.profile);
  const kbNames = kbh ? [...new Set(kbh.doc.items.map((x) => String(x.say_en || '').toLowerCase()).filter((x) => x.length >= 4))] : null;
  const KBS = require('../../knowledge/kb/source').catalogueSource(ctx.profile);
  const kbOn = KBS.mode === 'kb';
  let listed = 0;
  // KB v2 root causes 5 + 6, checked on the model's sentence; one repair (the same sentence, fixed), else drop
  const kbFaults = (t) => {
    if (!kbOn) return null;
    const nl = KBS.nameLock(t, ctx.lang);
    if (!nl.ok) return { reason: `kb_name_not_locked:${nl.hits[0].said}`, fix: nl.ambiguous ? null : nl.text };
    if (kbNames && namesIn(t, kbNames) >= 2 && moneyIn(t) === 1 && !boundPrice(t, kbNames)) return { reason: 'kb_price_unbound', fix: null };
    return null;
  };
  base.check = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return { verdict: 'drop', reason: 'empty' };
    const kf = kbFaults(s);
    if (kf) {
      // repair once: the fixed sentence must pass every check, or the sentence is dropped (never canned text)
      if (kf.fix && !kbFaults(kf.fix)) { const again = base.check(kf.fix); return again.verdict === 'pass' ? { verdict: 'repair', text: kf.fix, reason: kf.reason } : { verdict: 'drop', reason: `${kf.reason}|${again.reason || again.verdict}` }; }
      return { verdict: 'drop', reason: kf.reason };
    }
    if (READBACK_LIKE.test(s)) return { verdict: 'drop', reason: readbackTurn ? 'readback_mismatch_model' : 'model_readback' };
    const bad = timesIn(s).filter((t) => !times.has(t));
    if (bad.length) return { verdict: 'drop', reason: `time_not_in_receipts:${bad[0]}` };
    // v2 KB, Hick rule 2: at most 3 catalogue names in one turn; a longer model list is swapped for the rules-made receipt
    if (kbNames && namesIn(s, kbNames) + listed > MAX_LIST) return ctx.kbReceipt ? { verdict: 'repair', text: ctx.kbReceipt, reason: 'kb_list_over_3' } : { verdict: 'drop', reason: 'kb_list_over_3' };
    if (kbNames) listed += namesIn(s, kbNames);
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

const MAX_LIST = 3;
function namesIn(s, names) { const low = String(s || '').toLowerCase(); let n = 0; for (const x of names) if (low.includes(x)) n += 1; return n; }
// money mentions: "6,000 shillings", "KSh 6,000", "shilingi elfu sita"
const MONEY_RE = /\b(?:ksh\.?|kes)\s*\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:shillings?|bob|\/-)|\bshilingi\s+[a-z]+(?:\s+(?:na\s+)?[a-z]+){0,6}/gi;
function moneyIn(s) { return (String(s || '').match(MONEY_RE) || []).length; }
/** "A is 6,000 shillings" with one name: bound. Several names then one amount at the end: not bound (root cause 5). */
function boundPrice(s, names) {
  const low = String(s || '').toLowerCase();
  const m = MONEY_RE.exec(low); MONEY_RE.lastIndex = 0;
  if (!m) return true;
  const before = low.slice(0, m.index);
  const after = low.slice(m.index);
  // exactly one name before the amount (the item it belongs to), the other names after it in their own clause
  return namesIn(before, names) === 1 && namesIn(after, names) >= 1 && /[,;]|\b(and|na)\b/.test(after);
}

/** Engines never use callPlan replace verdicts. */
function actCheckEngines(text, st, ctx) {
  const g = CP.actCheck(text, st, ctx);
  if (g.verdict === 'replace') return { verdict: 'drop', reason: g.reason };
  return g;
}

module.exports = { makeEnginesVerifier, actCheckEngines, timesIn, allowedTimes, READBACK_LIKE, moneyIn, boundPrice };
