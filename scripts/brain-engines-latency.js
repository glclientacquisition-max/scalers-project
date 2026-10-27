#!/usr/bin/env node
'use strict';
// BRAIN_ENGINES latency sim with STAND-IN models (no Gemini, no keys, no call data).
// Model latencies are drawn from an assumed log-normal (median/p95 below, override with env);
// the numbers show how the 1.5 s understanding cap and the 700 ms filler shape what the caller hears.
// Real p50/p95 must come from staging voice_turn_traces (stage brain_engines).
const { makeCall, U } = require('../tests/helpers/enginesHarness');

const N = Number(process.env.SIM_TURNS || 300);
const UND = { median: Number(process.env.SIM_UND_MEDIAN || 700), p95: Number(process.env.SIM_UND_P95 || 1800) };
const REP = { median: Number(process.env.SIM_REP_MEDIAN || 600), p95: Number(process.env.SIM_REP_P95 || 1500) };
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const gauss = () => { const u = Math.max(rnd(), 1e-9); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const lognorm = ({ median, p95 }) => () => Math.round(median * Math.exp(gauss() * (Math.log(p95 / median) / 1.645)));
const pct = (xs, p) => { const a = xs.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };

const TURNS = [
  { say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'We open at 7:30 AM today.' },
  { say: 'Do you come to Rongai?', u: U({ intent: 'ask', answers: ['coverage'], slots: { place: 'Rongai' } }), reply: 'Yes, we cover Ongata Rongai.' },
  { say: 'I want carpet cleaning.', u: U({ intent: 'book', slots: { service: 'Carpet Cleaning' } }), reply: 'Sure. Which day suits you?' },
  { say: 'Nataka usafi wa sofa kesho.', u: U({ intent: 'book', lang: 'sw', slots: { service: 'Sofa Cleaning' } }), reply: 'Sawa kabisa, saa ngapi kesho?' },
];

(async () => {
  const rows = [];
  for (let i = 0; i < N; i += 1) {
    const c = makeCall({ now: '2026-10-26T10:00:00+03:00', understandDelayMs: lognorm(UND), replyDelayMs: lognorm(REP) });
    const step = TURNS[i % TURNS.length];
    const r = await c.say(step);
    const tr = c.traces.find((t) => t.kind === 'brain_engines') || {};
    rows.push({ realWord: tr.timings?.firstWordMs ?? null, first: r.firstSoundMs, wall: r.wallMs, filler: !!(r.streamed[0] && r.streamed[0].filler), und: tr.understandMs ?? tr.timings?.understandMs ?? null, outcome: tr.understanding?.outcome || tr.understandOutcome || null });
  }
  const out = {
    turns: N,
    assumed_model_ms: { understanding: UND, reply: REP },
    caps: { understand_ms: Number(process.env.BRAIN_ENGINES_UNDERSTAND_MS || 1500), filler_ms: Number(process.env.BRAIN_ENGINES_FILLER_MS || 700), reply_ms: Number(process.env.BRAIN_ENGINES_REPLY_MS || 2500) },
    first_sound_ms: { p50: pct(rows.map((r) => r.first), 0.5), p95: pct(rows.map((r) => r.first), 0.95), max: pct(rows.map((r) => r.first), 1) },
    first_real_word_ms: { p50: pct(rows.map((r) => r.realWord), 0.5), p95: pct(rows.map((r) => r.realWord), 0.95), max: pct(rows.map((r) => r.realWord), 1) },
    full_turn_ms: { p50: pct(rows.map((r) => r.wall), 0.5), p95: pct(rows.map((r) => r.wall), 0.95), max: pct(rows.map((r) => r.wall), 1) },
    filler_rate: +(rows.filter((r) => r.filler).length / N).toFixed(3),
    understanding_timeouts: rows.filter((r) => /timeout|cap/.test(String(r.outcome))).length,
  };
  console.log(JSON.stringify(out, null, 2));
})();
