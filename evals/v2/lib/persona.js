'use strict';
// Scripted caller persona (EN / SW / Sheng). Opening lines come from the scenario
// (each line may list paraphrase variants; the seed picks one), then the persona
// answers the agent's questions from its facts, says yes to read-backs, and hangs
// up when nothing is asked. An LLM persona slot exists (EVAL_PERSONA=llm) but no
// key is configured on the box, so runs use the scripted persona.
const { rngFor } = require('./rng');
const pick = (x, r) => (Array.isArray(x) ? x[Math.floor(r() * x.length)] : x);

function createPersona(scn, seed) {
  const r = rngFor('persona', scn.id, seed);
  const script = (scn.turns || []).map((t) => pick(t, r));
  const f = scn.facts || {};
  const sw = /^(sw|sheng)/.test(scn.lang);
  let k = 0;
  const answered = {};
  let idle = 0;
  return function caller({ lastAgentText }) {
    if (k < script.length) return script[k++];
    const a = String(lastAgentText || '');
    // a read-back question ("..., Nithibitishe?") is answered as a read-back even when it names a time
    const isReadback = /\?\s*$/.test(a) && /\b(shall i|nithibitishe|niendelee|go ahead)\b/i.test(a);
    const ask = (key, re) => !isReadback && re.test(a) && f[key] != null ? key : null;
    const key =
      ask('kesho', /\b(do you mean|unamaanisha)\b/i) ||
      ask('name', /\b(name|jina|nani)\b/i) ||
      ask('when', /\b(time|day|when|saa ngapi|siku gani|lini|morning|afternoon|asubuhi|mchana)\b/i) ||
      ask('place', /\b(where|wapi|area|eneo|location|address)\b/i) ||
      ask('quantity', /\b(how many|ngapi)\b/i) ||
      ask('item', /\b(which item|which one|kitu gani|gani)\b/i) ||
      ask('service', /\b(what do you need|tufanye nini|which service)\b/i) ||
      ask('which', /\b(which (one|visit|booking)|ipi)\b/i);
    if (key) { answered[key] = (answered[key] || 0) + 1; if (answered[key] > 3) return null; const v = f[key]; return v && v.seq ? v.seq[Math.min(answered[key] - 1, v.seq.length - 1)] : pick(v, r); }
    if (/\?\s*$/.test(a) && /\b(shall|should|go ahead|confirm|correct|right|sawa\?|niendelee|nithibitishe|is that|ni sawa|book it|save)\b/i.test(a)) {
      // edge cases: the first read-back gets a scripted reply (barge-in / change of mind), then yes
      if (f.onReadback && !answered.rb) { answered.rb = 1; return pick(f.onReadback, r); }
      answered.yes = (answered.yes || 0) + 1; if (answered.yes > 3) return null; return sw ? pick(['Ndio.', 'Ndio, sawa.'], r) : pick(['Yes.', 'Yes please.'], r);
    }
    if (/\?\s*$/.test(a) && idle < 1) { idle++; return sw ? 'Hapana, ni hayo tu.' : "No, that's all."; }
    return null;
  };
}
module.exports = { createPersona };
