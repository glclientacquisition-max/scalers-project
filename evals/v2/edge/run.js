#!/usr/bin/env node
'use strict';
// Edge-case sweep: generate -> run each case k times (seeds 1..k) on BRAIN_V2 -> cluster failures.
//   node evals/v2/edge/run.js [--k 4] [--seed 7] [--only regex] [--out file] [--show 3]
const fs = require('fs');
const path = require('path');
const { runCall, withEnv } = require('../lib/driver');
const { createModel } = require('../lib/model');
const { createPersona } = require('../lib/persona');
const { scoreRun } = require('../lib/score');
const { generate } = require('./gen');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ROOT = path.resolve(args.root || path.join(__dirname, '../../..'));
const K = Number(args.k || 4);
const dd = require('../fixtures/tenants/done_and_dusted.json');
const ddSun = JSON.parse(JSON.stringify(dd)); ddSun.hoursSchedule.days.sun = { open: null, close: null, closed: true };
const tenants = { done_and_dusted: dd, dd_sun_closed: ddSun };
const parF = path.join(__dirname, 'paraphrases.json');
const paraphrases = fs.existsSync(parF) && !args['no-paraphrase'] ? JSON.parse(fs.readFileSync(parF, 'utf8')) : {};
let cases = generate({ seed: Number(args.seed || 7), paraphrases });
// --expand: one case per opening variant (exact STT + perturbations + paraphrases), each run k times
if (args.expand) cases = cases.flatMap((c) => (Array.isArray(c.turns[0]) && c.turns[0].length > 1 ? c.turns[0].map((v, i) => ({ ...c, id: `${c.id}~v${i}`, variant: v, turns: [[v], ...c.turns.slice(1)] })) : [c]));
if (args.only) cases = cases.filter((c) => new RegExp(args.only).test(c.id));
const sig = (f) => f.replace(/ t\d+.*$/, '').replace(/".*$/, '').replace(/expected .*$/, '').replace(/ x\d+$/, '').trim();
const origLog = console.log, origWarn = console.warn;

(async () => {
  const res = [];
  await withEnv({ BRAIN_V2: 'on', BRAIN_CALL_FIXES_D199: 'on', BRAIN_TRUST_P1: 'on', CALLER_MEMORY_V2: 'on' }, async () => {
    for (const c of cases) {
      const runs = [];
      for (let seed = 1; seed <= K; seed++) {
        const profile = tenants[c.tenant];
        console.log = () => {}; console.warn = () => {};
        let run;
        try { run = await runCall({ root: ROOT, scenarioId: c.id, modelSeed: seed, profile, seed: c.seed || {}, model: createModel({ scenarioId: c.id, seed }), caller: createPersona(c, seed), now: new Date(c.now), businessName: profile.businessName, agentName: 'Shy' }); }
        finally { console.log = origLog; console.warn = origWarn; }
        const s = scoreRun(c, run);
        runs.push({ seed, pass: s.pass, fails: s.fails, transcript: run.turns.map((t) => [t.callerText, t.agentLine]) });
      }
      res.push({ id: c.id, cat: c.cat, rootHint: c.rootHint, lang: c.lang, now: c.now, passK: runs.every((r) => r.pass), pass1: runs.filter((r) => r.pass).length / K, runs });
    }
  });
  // cluster by root-cause hint (template family) x failure signature
  const clusters = {};
  for (const r of res.filter((x) => !x.passK)) {
    const sigs = [...new Set(r.runs.flatMap((x) => x.fails.map(sig)))].sort().join(' + ') || 'unknown';
    const key = `${r.rootHint} :: ${sigs}`;
    (clusters[key] = clusters[key] || { rootHint: r.rootHint, sigs, cases: [] }).cases.push(r.id);
  }
  const out = { k: K, cases: res.length, passK: res.filter((r) => r.passK).length, runs: res.length * K, clusters: Object.values(clusters).sort((a, b) => b.cases.length - a.cases.length), results: res };
  const file = args.out || path.join(__dirname, '../results', 'edge-v2.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  origLog(`cases=${out.cases} runs=${out.runs} pass^${K}=${out.passK}/${out.cases} (${(out.passK / out.cases * 100).toFixed(1)}%)`);
  for (const cl of out.clusters) {
    origLog(`\n[${cl.cases.length}] ${cl.rootHint} :: ${cl.sigs}\n   ${cl.cases.slice(0, 6).join(', ')}`);
    if (args.show) { const ex = res.find((r) => r.id === cl.cases[0]); const bad = ex.runs.find((x) => !x.pass); origLog('   ' + bad.transcript.map(([c, a]) => `C: ${c}\n   A: ${a}`).join('\n   ')); }
  }
})().catch((e) => { origLog(e.stack); process.exit(1); });
