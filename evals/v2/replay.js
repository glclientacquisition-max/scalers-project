#!/usr/bin/env node
'use strict';
// Replay real calls through the Brain at --root and score them against fixtures/replay/*.json.
//   node evals/v2/replay.js --root <build> --label main --flags prod [--only HD_212] [--k 4]
// recorded-model fixtures replay Gemini's recorded output per caller turn (deterministic, k=1);
// transcript-only fixtures (prod, no traces pulled) use the seeded model stand-in with k seeds.
const fs = require('fs');
const path = require('path');
const { runCall, withEnv } = require('./lib/driver');
const { createModel } = require('./lib/model');
const { scoreRun } = require('./lib/score');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ROOT = path.resolve(args.root || path.join(__dirname, '../..'));
const K = Number(args.k || 4);
const FLAGS = { prod: { BRAIN_CALL_FIXES_D199: null, BRAIN_TRUST_P1: null, CALLER_INFO_P1: null, CALLER_MEMORY_V2: null }, staging: { BRAIN_CALL_FIXES_D199: 'on', BRAIN_TRUST_P1: 'on', CALLER_INFO_P1: null, CALLER_MEMORY_V2: 'on' }, v2: { BRAIN_V2: 'on', BRAIN_CALL_FIXES_D199: 'on', BRAIN_TRUST_P1: 'on', CALLER_INFO_P1: null, CALLER_MEMORY_V2: 'on' } }[args.flags || 'prod'];
const dir = path.join(__dirname, 'fixtures/replay');
let files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
if (args.only) files = files.filter((f) => new RegExp(args.only).test(f));
if (args.labelled) files = files.filter((f) => JSON.parse(fs.readFileSync(path.join(dir, f))).label.by !== 'auto-observed');
const ol = console.log, ow = console.warn;
(async () => {
  const out = { label: args.label, flags: args.flags || 'prod', root: ROOT, cases: [] };
  await withEnv({ ...FLAGS, EVAL_FAULT_RATE: '0' }, async () => {
    for (const f of files) {
      const fx = JSON.parse(fs.readFileSync(path.join(dir, f)));
      const profile = require(`./fixtures/tenants/${fx.tenant}.json`);
      const seeds = fx.replayMode === 'recorded-model' && !/^(1|true|on)$/i.test(String(FLAGS.BRAIN_V2 || '')) ? [1] : Array.from({ length: K }, (_, i) => i + 1);
      const runs = [];
      for (const seed of seeds) {
        const stand = createModel({ scenarioId: fx.id, seed });
        const model = fx.replayMode === 'recorded-model' ? ({ i }) => fx.turns[i]?.model || '' : stand;
        const caller = ({ i }) => (i < fx.turns.length ? fx.turns[i].caller : null);
        console.log = () => {}; console.warn = () => {};
        let run;
        try { run = await runCall({ root: ROOT, scenarioId: fx.id, modelSeed: seed, profile, seed: fx.seed || {}, callerPhone: fx.callerPhone, model, caller, now: new Date(fx.createdAt.replace(' ', 'T').replace(/\+00(:00)?$/, 'Z')), businessName: profile.businessName, agentName: profile.agentName || 'Shy', maxTurns: 60 }); }
        finally { console.log = ol; console.warn = ow; }
        const s = scoreRun({ id: fx.id, lang: fx.lang, commitment: false, expect: fx.expect, mustSay: fx.mustSay, mustNotSay: fx.mustNotSay }, run);
        runs.push({ seed, ...s, transcript: run.turns.map((t) => ({ c: t.callerText, a: t.agentLine, o: t.outcome, tools: t.toolResults, ev: t.events })), ownerText: run.ownerText });
      }
      out.cases.push({ id: fx.id, env: fx.env, mode: fx.replayMode, labelled: fx.label.by !== 'auto-observed', passK: runs.every((r) => r.pass), endStatePassK: runs.every((r) => r.endStatePass), runs });
    }
  });
  const C = out.cases;
  const allRuns = C.flatMap((c) => c.runs);
  const turns = allRuns.reduce((a, r) => a + r.agentTurns, 0);
  const claimTurns = allRuns.reduce((a, r) => a + new Set(r.claims.map((c) => c.turn)).size, 0);
  out.summary = { cases: C.length, labelled: C.filter((c) => c.labelled).length, passK: +(C.filter((c) => c.passK).length / (C.length || 1)).toFixed(3), labelledPassK: +(C.filter((c) => c.labelled && c.passK).length / (C.filter((c) => c.labelled).length || 1)).toFixed(3), endStatePassK: +(C.filter((c) => c.endStatePassK).length / (C.length || 1)).toFixed(3), falseClaimTurnRate: +(claimTurns / (turns || 1)).toFixed(4), agentTurns: turns, ownerLeak: allRuns.filter((r) => r.fails.includes('owner_email_instruction_leak')).length, claimsByClass: allRuns.flatMap((r) => r.claims).reduce((m, c) => ((m[c.cls] = (m[c.cls] || 0) + 1), m), {}) };
  const file = path.join(__dirname, 'results', `replay-${args.label}-${out.flags}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  ol(JSON.stringify(out.summary));
  for (const c of C.filter((c) => c.labelled || !c.passK)) ol(`${c.passK ? 'PASS' : 'FAIL'} ${c.id} [${c.env}/${c.mode}${c.labelled ? '/labelled' : ''}] :: ${[...new Set(c.runs.flatMap((r) => r.fails.map((x) => x.slice(0, 110))))].slice(0, 5).join(' ; ')}`);
})().catch((e) => { ol(e.stack); process.exit(1); });
