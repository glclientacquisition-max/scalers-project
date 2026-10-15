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
        // BRAIN_V2_TOPIC_PROPOSALS: v2 returns proposals for the TurnArbiter instead of a line; check every claimed one.
        const INTENT = { catalogue: 'services', fallback: 'services', explain: 'explain', price: 'price' };
        const replies = Array.isArray(m?.v2Raw)
          ? m.v2Raw.filter((p) => p.claim && p.text).map((p) => ({ line: p.text, lang: p.lang, intent: INTENT[p.kind] || null, kind: p.kind }))
          : m?.line ? [{ line: m.line, lang: m.v2.lang, intent: m.v2.intent }] : [];
        for (const x of replies) {
          spoken += 1;
          const r = senseCheck({ line: x.line, lang: x.lang, caller: t.caller, intent: x.intent, sc: resolveSpokenCatalogue(c.profile) });
          if (!r.ok) fails += 1;
          out.push(`${r.ok ? 'ok  ' : 'FAIL'} ${c.callId} T${t.turn || i + 1} [${x.lang}]${x.kind ? ` ${x.kind}` : ''} "${t.caller}" -> "${x.line}"${r.ok ? '' : `  (${r.problems.join(', ')})`}`);
        }
      }
    }
  }
  console.log(out.join('\n')); console.log(`v2 catalogue lines: ${spoken}, sense-check fails: ${fails}`);
  process.exit(fails ? 1 : 0);
})();
