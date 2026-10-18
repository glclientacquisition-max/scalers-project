#!/usr/bin/env node
'use strict';
// Regression-9 runner: `node evals/v2/regression/run.js [--flags v2] [--k 4] [--only R3] [--json]`
// Exit 1 on any FAIL (a non-xfail case that breaks). XFAIL / XPASS never fail the run.
// Offline: no network, no DB, no model key (seeded model stand-in), no secrets.
const path = require('path');
const { runCall, withEnv } = require('../lib/driver');
const { createModel } = require('../lib/model');
const { createPersona } = require('../lib/persona');
const { scoreRun } = require('../lib/score');
const cases = require('./cases');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ROOT = path.resolve(args.root || path.join(__dirname, '../../..'));
const K = Number(args.k || 4);
// v2 = run.js v2 profile + the Brain fixes these cases lock in (BRAIN_V2_NLU_GAPS).
const FLAGS = {
  v2: { BRAIN_V2: 'on', BRAIN_V2_NLU_GAPS: 'on', BRAIN_CALL_FIXES_D199: 'on', BRAIN_TRUST_P1: 'on', CALLER_INFO_P1: null, CALLER_MEMORY_V2: 'on',
    // Voice R6-R9 flags (all off in prod by default): R9 changes prepareForTts, so the pack runs it on.
    VOICE_OUTAGE_DEBOUNCE: 'on', VOICE_NAME_GATE_ANSWER: 'on', VOICE_FILLER_SLOT: 'on', VOICE_TTS_LINE_LANG: 'on' },
}[args.flags || 'v2'];
if (!FLAGS) { console.error(`unknown --flags ${args.flags} (supported: v2)`); process.exit(2); }
const NOW = new Date('2026-10-14T05:00:00Z'); // Wed 08:00 EAT
const tenants = { done_and_dusted: require('../fixtures/tenants/done_and_dusted.json'), retail_shop: require('../fixtures/tenants/retail_shop.json'), synthetic_cleaner: require('../fixtures/tenants/synthetic_cleaner.json') };
const list = args.only ? cases.filter((c) => new RegExp(args.only).test(c.id)) : cases;
const quiet = async (fn) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };

(async () => {
  const results = [];
  await withEnv(FLAGS, async () => {
    for (const c of list) {
      const fails = [];
      if (c.kind === 'probe') {
        try { fails.push(...c.probe(ROOT)); } catch (e) { fails.push(`probe_error ${e.message}`); }
      } else {
        for (let seed = 1; seed <= K; seed++) {
          const profile = tenants[c.tenant];
          let run;
          try {
            run = await quiet(() => runCall({ root: ROOT, scenarioId: c.id, modelSeed: seed, profile, seed: c.seed || {}, model: createModel({ scenarioId: c.id, seed }), caller: createPersona(c, seed), now: NOW, businessName: profile.businessName, agentName: profile.agentName || 'Shy', callLanguage: c.callLanguage || null }));
          } catch (e) { fails.push(`seed${seed} harness_error ${e.message}`); continue; }
          const own = [...(c.check ? c.check(run) : []), ...cases.lint(run), ...cases.writeNeedsReadback(run)];
          if (c.expect) { const s = scoreRun(c, run); if (!s.pass) own.push(...s.fails); }
          for (const f of own) fails.push(`seed${seed} ${f}`);
        }
      }
      const ok = fails.length === 0;
      const status = c.xfail ? (ok ? 'XPASS' : 'XFAIL') : ok ? 'PASS' : 'FAIL';
      results.push({ bug: c.bug, id: c.id, lang: c.lang, title: c.title, status, owner: c.xfail?.owner || 'Brain', fails: [...new Set(fails)].slice(0, 8), note: c.xfail?.note });
    }
  });
  const count = (s) => results.filter((r) => r.status === s).length;
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} bug${r.bug} ${r.id} [${r.lang}] (${r.owner})${r.fails.length ? ' :: ' + r.fails.slice(0, 3).join(' ; ') : ''}`);
    if (r.status === 'XFAIL') console.log(`      owner note: ${r.note}`);
    if (r.status === 'XPASS') console.log(`      XPASS: ${r.owner} can drop the xfail on ${r.id}`);
  }
  const summary = { flags: args.flags || 'v2', k: K, cases: results.length, bugs: new Set(results.map((r) => r.bug)).size, pass: count('PASS'), fail: count('FAIL'), xfail: count('XFAIL'), xpass: count('XPASS') };
  console.log(JSON.stringify(summary));
  if (args.json) require('fs').writeFileSync(args.json, JSON.stringify({ summary, results }, null, 1));
  process.exit(summary.fail ? 1 : 0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
