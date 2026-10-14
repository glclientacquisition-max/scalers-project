#!/usr/bin/env node
'use strict';
// BA v2 Phase 0 harness runner.
//   node evals/v2/run.js --root <build checkout> --label main --flags prod --k 4 [--only S01] [--out file]
// Runs every scenario k times (seeds 1..k) in-process against the Brain at --root, scores
// final DB state + speech, and reports pass^1, pass^k, false-claim rate, booking correctness,
// and p50/p95 Brain-only turn latency (model stand-in time excluded).
const fs = require('fs');
const path = require('path');
const { runCall, withEnv } = require('./lib/driver');
const { createModel } = require('./lib/model');
const { createPersona } = require('./lib/persona');
const { scoreRun } = require('./lib/score');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ROOT = path.resolve(args.root || path.join(__dirname, '../..'));
const K = Number(args.k || 4);
const FLAGS = {
  prod: { BRAIN_CALL_FIXES_D199: null, BRAIN_TRUST_P1: null, CALLER_INFO_P1: null, BRAIN_CONFIRMED_COVERAGE: null, CALLER_MEMORY_V2: null, FACT_HASH_MODE: null },
  staging: { BRAIN_CALL_FIXES_D199: 'on', BRAIN_TRUST_P1: 'on', CALLER_INFO_P1: null, BRAIN_CONFIRMED_COVERAGE: null, CALLER_MEMORY_V2: 'on', FACT_HASH_MODE: null },
  v2: { BRAIN_V2: 'on', BRAIN_CALL_FIXES_D199: 'on', BRAIN_TRUST_P1: 'on', CALLER_INFO_P1: null, CALLER_MEMORY_V2: 'on' },
  'staging+ci': { BRAIN_CALL_FIXES_D199: 'on', BRAIN_TRUST_P1: 'on', CALLER_INFO_P1: 'on', CALLER_MEMORY_V2: 'on' },
}[args.flags || 'prod'];
const NOW = new Date('2026-10-14T05:00:00Z'); // Wed 08:00 EAT
const tenants = { done_and_dusted: require('./fixtures/tenants/done_and_dusted.json'), retail_shop: require('./fixtures/tenants/retail_shop.json') };
let suite = require('./scenarios/suite.js');
if (args.only) suite = suite.filter((s) => new RegExp(args.only).test(s.id));

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(2); };
const origLog = console.log, origWarn = console.warn;

(async () => {
  const out = { label: args.label || path.basename(ROOT), root: ROOT, flags: args.flags || 'prod', k: K, faultRate: require('./lib/model').FAULT_RATE, persona: 'scripted', scenarios: [] };
  await withEnv(FLAGS, async () => {
    { // JIT warm-up, untimed
      const w = require('./scenarios/suite.js')[0]; console.log = () => {}; console.warn = () => {};
      try { await runCall({ root: ROOT, profile: tenants[w.tenant], seed: {}, model: createModel({ scenarioId: 'warm', seed: 0 }), caller: createPersona(w, 0), now: NOW, businessName: 'warm' }); } finally { console.log = origLog; console.warn = origWarn; }
    }
    for (const scn of suite) {
      const runs = [];
      for (let seed = 1; seed <= K; seed++) {
        const model = createModel({ scenarioId: scn.id, seed });
        const caller = createPersona(scn, seed);
        const profile = tenants[scn.tenant];
        console.log = () => {}; console.warn = () => {};
        let run;
        try { run = await runCall({ root: ROOT, scenarioId: scn.id, modelSeed: seed, profile, seed: scn.seed || {}, model, caller, now: NOW, businessName: profile.businessName, agentName: profile.agentName || 'Shy' }); }
        finally { console.log = origLog; console.warn = origWarn; }
        const s = scoreRun(scn, run);
        runs.push({ seed, ...s, faults: run.modelFaults || model.injected, transcript: run.turns.map((t) => ({ c: t.callerText, a: t.agentLine, o: t.outcome, tools: t.toolResults, ms: +t.brainMs.toFixed(2), ev: t.events })), ownerText: run.ownerText });
      }
      out.scenarios.push({ id: scn.id, area: scn.area, lang: scn.lang, commitment: !!scn.commitment, passK: runs.every((r) => r.pass), pass1: runs.filter((r) => r.pass).length / K, endStatePassK: runs.every((r) => r.endStatePass), runs });
    }
  });
  const S = out.scenarios;
  const allRuns = S.flatMap((s) => s.runs);
  const turns = allRuns.flatMap((r) => r.brainMs);
  const agentTurns = allRuns.reduce((a, r) => a + r.agentTurns, 0);
  const claimTurns = allRuns.reduce((a, r) => a + new Set(r.claims.map((c) => c.turn)).size, 0);
  const commit = S.filter((s) => s.commitment);
  out.summary = {
    scenarios: S.length,
    passK: +(S.filter((s) => s.passK).length / S.length).toFixed(3),
    pass1: +(S.reduce((a, s) => a + s.pass1, 0) / S.length).toFixed(3),
    endStatePassK: +(S.filter((s) => s.endStatePassK).length / S.length).toFixed(3),
    bookingCorrectnessPassK: +(commit.filter((s) => s.endStatePassK).length / (commit.length || 1)).toFixed(3),
    bookingCorrectnessPass1: +(commit.reduce((a, s) => a + s.runs.filter((r) => r.endStatePass).length / K, 0) / (commit.length || 1)).toFixed(3),
    readbackCompliance: +(commit.reduce((a, s) => a + s.runs.filter((r) => !r.fails.some((f) => f.startsWith('readback'))).length / K, 0) / (commit.length || 1)).toFixed(3),
    falseClaimTurnRate: +(claimTurns / (agentTurns || 1)).toFixed(4),
    falseClaimRunsWithAny: +(allRuns.filter((r) => r.claims.length).length / allRuns.length).toFixed(3),
    claimsByClass: allRuns.flatMap((r) => r.claims).reduce((m, c) => ((m[c.cls] = (m[c.cls] || 0) + 1), m), {}),
    agentTurns,
    brainMsP50: pct(turns.map((t) => t.ms), 50), brainMsP95: pct(turns.map((t) => t.ms), 95),
    brainMsP95ToolTurns: pct(turns.filter((t) => t.tool).map((t) => t.ms), 95),
    harnessErrors: allRuns.filter((r) => r.fails.some((f) => f.startsWith('harness_error'))).length,
  };
  const file = args.out || path.join(__dirname, 'results', `${out.label}-${out.flags}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  origLog(JSON.stringify({ label: out.label, flags: out.flags, ...out.summary }, null, 1));
  for (const s of S) origLog(`${s.passK ? 'PASS' : 'FAIL'} ${s.id} pass1=${s.pass1} endState^k=${s.endStatePassK} :: ${[...new Set(s.runs.flatMap((r) => r.fails.map((f) => f.replace(/ t\d+.*$/, '').replace(/".*$/, ''))))].slice(0, 6).join(' ; ')}`);
})().catch((e) => { origLog(e.stack); process.exit(1); });
