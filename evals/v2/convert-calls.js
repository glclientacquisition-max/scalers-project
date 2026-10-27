#!/usr/bin/env node
'use strict';
// Real call -> replay case converter.
//   node evals/v2/convert-calls.js            (all raw staging + prod exports)
// Input:  fixtures/raw/{staging_calls,staging_traces,prod_calls}.json (pulled read-only with SELECT)
// Output: fixtures/replay/<sid>.json  { sid, env, tenant, release, turns[{caller, model, agent}],
//          observed{rows, ownerBody}, expect{...}, label }
// Expected end state comes from fixtures/replay-labels.json when a human label exists
// (the named regression calls), otherwise it is the observed end state ("auto-observed":
// a regression lock, not a correctness claim).
const fs = require('fs');
const path = require('path');
const D = __dirname;
const { langOf } = require('./lib/score');
const rd = (f) => (fs.existsSync(path.join(D, f)) ? JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')) : []);
const labels = rd('fixtures/replay-labels.json');
const traces = rd('fixtures/raw/staging_traces.json');
const tenantFile = (env, tenantId) => {
  if (env === 'staging') return 'done_and_dusted';
  const f = `prod_${String(tenantId).slice(0, 8)}`;
  return fs.existsSync(path.join(D, 'fixtures/tenants', `${f}.json`)) ? f : null;
};
const isCaller = (s) => /^(user|caller|customer)$/i.test(String(s));

function turnsFromTraces(sid) {
  const rows = traces.filter((t) => t.sid === sid && t.kind === 'turn').sort((a, b) => a.turn - b.turn);
  if (!rows.length) return null;
  const out = [];
  for (const r of rows) {
    const p = r.payload || {};
    const st = p.stages || [];
    const model = st.filter((s) => s.stage === 'model' && s.phase === 'output').map((s) => s.outputText || '').join('\n').trim();
    const agent = st.filter((s) => s.stage === 'tts').map((s) => s.text).join(' ').trim();
    const lat = st.find((s) => s.stage === 'latency') || {};
    const text = String(p.caller?.text || '').trim();
    if (!text) continue;
    // Voice re-processes a merged final as a second turn with the same text; keep the one with model output.
    const prev = out[out.length - 1];
    if (prev && prev.caller === text) { if (model) prev.model = model; prev.agent = [prev.agent, agent].filter(Boolean).join(' '); continue; }
    out.push({ caller: text, model, agent, lang: p.caller?.language || null, latency: { callerStopToFirstTtsPcmMs: lat.callerStopToFirstTtsPcmMs ?? null, callerStopToModelFirstTokenMs: lat.callerStopToModelFirstTokenMs ?? null } });
  }
  return out;
}

function turnsFromTranscript(tx) {
  const out = [];
  let cur = null;
  for (const m of tx || []) {
    if (isCaller(m.speaker)) { cur = { caller: String(m.text || '').trim(), model: '', agent: '' }; out.push(cur); }
    else if (cur) cur.agent = [cur.agent, m.text].filter(Boolean).join(' ');
  }
  return out.filter((t) => t.caller);
}

function observedExpect(c) {
  const sr = (c.service_requests || []).filter((r) => !/callback|complain|handoff/i.test(r.type || ''));
  return { appointments: (c.appointments || []).length, service_requests: sr.length, _source: 'auto-observed' };
}

function convert(c, env) {
  const tenant = tenantFile(env, c.tenant_id);
  if (!tenant) return null;
  const turns = (env === 'staging' && turnsFromTraces(c.sid)) || turnsFromTranscript(c.transcript);
  if (!turns.length) return null;
  const label = labels.find((l) => l.sid === c.sid);
  const owner = (c.notify || []).filter((n) => n.audience === 'owner' || /email/.test(n.channel || '')).map((n) => n.body).join('\n---\n');
  return {
    id: `R_${c.sid}`, sid: c.sid, env, tenant, createdAt: c.created_at, callerPhone: c.caller_number || '+254700000009',
    replayMode: turns.some((t) => t.model) ? 'recorded-model' : 'transcript-only',
    lang: label?.lang || (turns.filter((t) => (t.lang ? /sw|sheng/.test(t.lang) : langOf(t.caller) === 'sw')).length > turns.length / 2 ? 'sw' : 'en'),
    commitment: label?.commitment ?? false,
    turns,
    observed: { service_requests: c.service_requests || [], appointments: c.appointments || [], resolution: c.resolution, resolution_note: c.resolution_note, primary_intent: c.primary_intent, ownerBody: owner || null },
    expect: label?.expect || observedExpect(c),
    label: label ? { by: label.by, why: label.why } : { by: 'auto-observed', why: 'regression lock on the observed end state' },
    seed: label?.seed || {},
  };
}

const outDir = path.join(D, 'fixtures/replay');
fs.mkdirSync(outDir, { recursive: true });
let n = 0;
for (const [file, env] of [['fixtures/raw/staging_calls.json', 'staging'], ['fixtures/raw/prod_calls.json', 'prod']]) {
  for (const c of rd(file)) {
    const f = convert(c, env);
    if (!f) continue;
    fs.writeFileSync(path.join(outDir, `${c.sid}.json`), JSON.stringify(f, null, 1));
    n++;
  }
}
console.log(`wrote ${n} replay fixtures to ${outDir}`);
