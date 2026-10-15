#!/usr/bin/env node
// Replays every HD fixture's caller turns through the v2 catalogue step (rules
// command source) and sense-checks each line it would speak. Exit 1 on a fail.
process.env.VOICE_V2_CATALOGUE = '1';
const fs = require('fs'); const path = require('path');
const { planV2CatalogueMouth } = require('../src/conversation/v2CatalogueTurn');
const { senseCheck } = require('../src/conversation/v2/senseCheck');
const { resolveSpokenCatalogue } = require('../src/knowledge/spokenCatalogue');
const root = path.join(__dirname, '..', 'tests', 'fixtures');
const files = ['voice-calls', 'no-answer-delete', 'hedge-gap'].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.json')).map((f) => path.join(root, d, f)));
function callsOf(j) {
  if (Array.isArray(j.turns) && j.turns[0]?.callId && j.catalogue) {
    const by = {}; for (const t of j.turns) (by[t.callId] ||= []).push(t);
    return Object.entries(by).map(([callId, turns]) => ({ callId, profile: { servicesCatalog: j.catalogue.map((name) => ({ name })) }, turns }));
  }
  const profile = j.profile || (j.servicesCatalog ? j : { servicesCatalog: (j.catalogue || []).map((name) => (typeof name === 'string' ? { name } : name)) });
  const turns = j.turns || (j.t7 ? [j.t7] : []);
  return [{ callId: j.callId, profile, turns, lang: j.lang }];
}
(async () => {
  let fails = 0; let spoken = 0; const out = [];
  for (const f of files) {
    for (const c of callsOf(JSON.parse(fs.readFileSync(f, 'utf8')))) {
      const state = {}; let lang = null;
      for (const [i, t] of c.turns.entries()) {
        lang = lang || c.lang || t.lang || t.soniox || 'en';
        const m = await planV2CatalogueMouth(null, { text: t.caller, profile: c.profile, language: lang, state, model: null });
        if (!m?.line) continue;
        spoken += 1;
        const r = senseCheck({ line: m.line, lang: m.v2.lang, caller: t.caller, intent: m.v2.intent, sc: resolveSpokenCatalogue(c.profile) });
        if (!r.ok) fails += 1;
        out.push(`${r.ok ? 'ok  ' : 'FAIL'} ${c.callId} T${t.turn || i + 1} [${m.v2.lang}] "${t.caller}" -> "${m.line}"${r.ok ? '' : `  (${r.problems.join(', ')})`}`);
      }
    }
  }
  console.log(out.join('\n')); console.log(`v2 catalogue lines: ${spoken}, sense-check fails: ${fails}`);
  process.exit(fails ? 1 : 0);
})();
