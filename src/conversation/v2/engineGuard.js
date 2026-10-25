'use strict';
// Guard for BRAIN_ENGINES: repair once or drop; no callPlan replace templates.
const ML = require('./modelLead');
const CP = require('./callPlan');

function makeEnginesVerifier(ctx) {
  const base = ML.makeVerifier(ctx);
  const origCheck = base.check.bind(base);
  base.check = (raw) => {
    const v = origCheck(raw);
    if (v.verdict === 'replace') {
      const reason = String(v.reason || '');
      if (/^(off_step:|readback_mismatch)/.test(reason)) {
        return { verdict: 'pass', text: String(raw || '').trim(), reason: `${reason}_engines_pass` };
      }
      if (v.fix) return { verdict: 'repair', text: v.fix, reason: v.reason };
      return { verdict: 'drop', reason: v.reason };
    }
    return v;
  };
  return base;
}

function actCheckEngines(text, st, ctx) {
  const g = CP.actCheck(text, st, ctx);
  if (g.verdict === 'replace') return { verdict: 'pass', text: String(text || '').trim(), reason: g.reason };
  return g;
}

module.exports = { makeEnginesVerifier, actCheckEngines };
