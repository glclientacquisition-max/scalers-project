#!/usr/bin/env node
'use strict';

// C7 eval:v2:shadow-agreement. Reads BRAIN_V2_MODEL=shadow stages (stage='brain_v2_model') and
// reports model-vs-rules agreement by rules intent, p50/p95 model latency, timeouts and cost.
// Input: files exported from the SELECT in docs/explanation/brain/v2-model-shadow.md (JSON array
// or JSONL of rows; a row is a stage, {stage: {...}}, or a voice_turn_traces row with payload.stages).
// No database or network access: it only reads the files it is given.
//   node evals/v2/shadowAgreement.js [--json] [file ...]   (default: the bundled fixture)
const fs = require('node:fs');
const path = require('node:path');

const GATE = { agreement: 0.95, p95Ms: 900 };
const TURNS_PER_CALL = 12;

function rowsOf(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.startsWith('[')) return JSON.parse(t);
  return t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}
function stagesOf(row) {
  if (!row || typeof row !== 'object') return [];
  if (row.stage === 'brain_v2_model') return [{ ...row, callId: row.callId || row.call_id || null }];
  const callId = row.call_id || row.callId || null;
  if (row.stage && typeof row.stage === 'object') return stagesOf({ ...row.stage, call_id: callId });
  if (row.model_stage) return stagesOf({ ...(typeof row.model_stage === 'string' ? JSON.parse(row.model_stage) : row.model_stage), call_id: callId });
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return (payload?.stages || []).filter((s) => s && s.stage === 'brain_v2_model').map((s) => ({ ...s, callId }));
}
function pct(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
function report(stages) {
  const by = {};
  let agree = 0; let intentAgree = 0; let timeouts = 0; let errors = 0; let invalid = 0; let usd = 0; let inTok = 0; let outTok = 0;
  const lat = [];
  const calls = new Set();
  for (const s of stages) {
    const k = s.rules?.intent || 'none';
    by[k] = by[k] || { n: 0, agree: 0 };
    by[k].n += 1;
    if (s.agree) { agree += 1; by[k].agree += 1; }
    if (s.intentAgree) intentAgree += 1;
    if (s.timedOut) timeouts += 1;
    if (s.error) errors += 1;
    if (s.proposal && s.proposal.valid === false) invalid += 1;
    if (Number.isFinite(s.latencyMs)) lat.push(s.latencyMs); // a timeout counts at its capped latency
    usd += Number(s.tokens?.costUsd || 0); inTok += Number(s.tokens?.in || 0); outTok += Number(s.tokens?.out || 0) + Number(s.tokens?.thoughts || 0);
    if (s.callId) calls.add(s.callId);
  }
  const n = stages.length;
  const perTurnUsd = n ? usd / n : 0;
  const nCalls = calls.size || null;
  const out = {
    turns: n,
    agreement: n ? agree / n : null,
    intentAgreement: n ? intentAgree / n : null,
    byIntent: Object.fromEntries(Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, { n: v.n, agreement: v.agree / v.n }])),
    latency: { p50: pct(lat, 50), p95: pct(lat, 95), max: lat.length ? Math.max(...lat) : null },
    timeoutRate: n ? timeouts / n : null,
    errorRate: n ? errors / n : null,
    invalidProposals: invalid,
    tokens: { avgIn: n ? Math.round(inTok / n) : null, avgOut: n ? Math.round(outTok / n) : null },
    cost: { perTurnUsd: Number(perTurnUsd.toFixed(6)), perCallUsd: Number((nCalls ? usd / nCalls : perTurnUsd * TURNS_PER_CALL).toFixed(5)), perCallBasis: nCalls ? `${nCalls} calls` : `${TURNS_PER_CALL} turns per call (no call ids)` },
  };
  out.gate = { agreement: GATE.agreement, p95Ms: GATE.p95Ms, pass: n > 0 && out.agreement >= GATE.agreement && out.latency.p95 != null && out.latency.p95 < GATE.p95Ms };
  return out;
}
function fmt(r) {
  const p = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  const lines = [
    `brain_v2_model shadow: ${r.turns} turns`,
    `agreement ${p(r.agreement)} (intent only ${p(r.intentAgreement)})`,
    'by rules intent:',
    ...Object.entries(r.byIntent).map(([k, v]) => `  ${k.padEnd(14)} n=${String(v.n).padStart(4)}  ${p(v.agreement)}`),
    `latency p50 ${r.latency.p50 ?? 'n/a'} ms, p95 ${r.latency.p95 ?? 'n/a'} ms, max ${r.latency.max ?? 'n/a'} ms`,
    `timeouts ${p(r.timeoutRate)}, errors ${p(r.errorRate)}, invalid proposals ${r.invalidProposals}`,
    `tokens avg in ${r.tokens.avgIn ?? 'n/a'}, out ${r.tokens.avgOut ?? 'n/a'}; cost $${r.cost.perTurnUsd}/turn, $${r.cost.perCallUsd}/call (${r.cost.perCallBasis})`,
    `gate (>= ${GATE.agreement * 100}% agreement and p95 < ${GATE.p95Ms} ms): ${r.gate.pass ? 'PASS' : 'FAIL'}`,
  ];
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const files = args.filter((a) => a !== '--json');
  const list = files.length ? files : [path.join(__dirname, 'fixtures', 'shadow-agreement.jsonl')];
  const stages = list.flatMap((f) => rowsOf(fs.readFileSync(f, 'utf8')).flatMap(stagesOf));
  const r = report(stages);
  process.stdout.write(`${json ? JSON.stringify(r, null, 2) : `${files.length ? '' : '(bundled fixture; pass exported rows to score staging)\n'}${fmt(r)}`}\n`);
}

module.exports = { rowsOf, stagesOf, report, fmt, pct, GATE };
