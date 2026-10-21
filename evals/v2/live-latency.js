#!/usr/bin/env node
'use strict';
// Live latency baseline from staging voice_turn_traces (pulled read-only): per turn
// callerStop->model first token and callerStop->first TTS audio, split by tool turns
// (model output carried a ###TOOL### marker).
const traces = require('./fixtures/raw/staging_traces.json');
const pct = (xs, p) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null; };
const rows = [];
for (const t of traces) {
  if (t.kind !== 'turn') continue;
  const st = t.payload?.stages || [];
  const lat = st.find((s) => s.stage === 'latency');
  if (!lat) continue;
  const out = st.filter((s) => s.stage === 'model' && s.phase === 'output').map((s) => s.outputText || '').join(' ');
  rows.push({ sid: t.sid, tool: /###TOOL###/.test(out), firstTok: lat.callerStopToModelFirstTokenMs, firstPcm: lat.callerStopToFirstTtsPcmMs });
}
const sum = (rs) => ({ n: rs.length, firstTokenP50: pct(rs.map((r) => r.firstTok), 50), firstTokenP95: pct(rs.map((r) => r.firstTok), 95), firstAudioP50: pct(rs.map((r) => r.firstPcm), 50), firstAudioP95: pct(rs.map((r) => r.firstPcm), 95) });
const res = { calls: new Set(rows.map((r) => r.sid)).size, all: sum(rows), toolTurns: sum(rows.filter((r) => r.tool)), answerTurns: sum(rows.filter((r) => !r.tool)) };
require('fs').writeFileSync(require('path').join(__dirname, 'results/live-latency-staging.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
