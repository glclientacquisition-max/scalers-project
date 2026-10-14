#!/usr/bin/env node
'use strict';
// Phase 1 bar check over a suite result + replay result.
//   node evals/v2/bar.js results/v2-v2.json results/replay-v2-v2.json
const path = require('path');
const { langOf } = require('./lib/score');
const [suiteF, replayF] = process.argv.slice(2).map((f) => require(path.resolve(f)));
const suite = require('./scenarios/suite.js');
const langOfId = Object.fromEntries(suite.map((s) => [s.id, s.lang]));
const fx = (id) => { try { return require(`./fixtures/replay/${id.replace(/^R_/, '')}.json`); } catch { return null; } };
function swMatch(cases, getLang, all = false) {
  let n = 0, ok = 0;
  for (const c of cases) { const lg = getLang(c); if (!all && !/^(sw|sheng)/.test(lg || '')) continue; for (const r of c.runs) { n += r.langTurns || 0; ok += (r.langTurns || 0) - (r.langMismatch || 0); } }
  return { turns: n, rate: n ? +(ok / n).toFixed(4) : null };
}
const S = suiteF.summary;
const booking = suiteF.scenarios.filter((s) => s.commitment);
const hd212 = replayF.cases.find((c) => /212e49ef183f/.test(c.id));
const allRuns = [...suiteF.scenarios.flatMap((s) => s.runs), ...replayF.cases.flatMap((c) => c.runs)];
const claims = allRuns.reduce((a, r) => a + r.claims.length, 0);
const leaks = allRuns.filter((r) => r.fails.includes('owner_email_instruction_leak')).length;
const swS = swMatch(suiteF.scenarios, (s) => langOfId[s.id]);
const swR = swMatch(replayF.cases, (c) => fx(c.id)?.lang);
const swA = swMatch(replayF.cases, (c) => fx(c.id)?.lang, true);
const A = require('./lib/ack');
const ackRuns = [...suiteF.scenarios.flatMap((s) => s.runs), ...replayF.cases.filter((c) => c.env !== 'prod').flatMap((c) => c.runs)].map(A.lines);
const ack = A.ackMetrics(ackRuns); const bank = A.fillerBank(path.resolve(__dirname, '../..'));
const bar = [
  ['Booking pass^4 >= 90% (commitment scenarios, all rules)', +(booking.filter((s) => s.passK).length / booking.length).toFixed(3), (v) => v >= 0.9],
  ['Booking end-state pass^4 (DB rows only)', S.bookingCorrectnessPassK, (v) => v >= 0.9],
  ['HD_212 replay passes', hd212 ? hd212.passK : null, (v) => v === true],
  ['Suite pass^4 >= 85%', S.passK, (v) => v >= 0.85],
  ['Read-back + yes on 100% of commitments', S.readbackCompliance, (v) => v === 1],
  ['False claims = 0 (suite + replay)', claims, (v) => v === 0],
  ['Owner-email leaks = 0 (suite + replay)', leaks, (v) => v === 0],
  ['p95 Brain ms on tool turns <= 300', S.brainMsP95ToolTurns, (v) => v != null && v <= 300],
  ['SW/Sheng language match per turn >= 98% (suite)', swS.rate, (v) => v >= 0.98],
  ['Ack-led turns <= 10% excluding goodbyes (suite + staging replays)', ack.ackRate, (v) => v <= 0.10],
  ['Consecutive ack-led turns = 0', ack.consecutive, (v) => v === 0],
  ['Ack stacks = 0', ack.stacks, (v) => v === 0],
  ['Voice filler/hold bank <= 3 words', bank.over.length ? bank.over.join(' | ') : `${bank.n} lines ok`, () => bank.n > 0 && bank.over.length === 0],
  ['SW/Sheng language match, per turn (SW-labelled replays)', swR.rate, () => null],
  ['Language match per turn, all 87 replays (code-switch included)', swA.rate, () => null],
];
for (const [k, v, f] of bar) { const p = f(v); console.log(`${p === null ? 'INFO' : p ? 'PASS' : 'FAIL'}  ${k}: ${v}`); }
console.log(JSON.stringify({ ack }));
console.log(JSON.stringify({ swSuiteTurns: swS.turns, swReplayTurns: swR.turns, replay: replayF.summary }));
