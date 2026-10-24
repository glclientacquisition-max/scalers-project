'use strict';
// Phase B first-reply latency sim (RCA HD_b4afd63a69c3 #3). NOT production numbers: model delays are drawn from
// assumed distributions (draft first say ~ lognormal median 900ms, sigma .35; understanding U[250,750]ms;
// stable partial arrives U[0,400]ms before the final). Measures run() start -> first sentence handed to TTS.
// Excludes STT endpointing, network and TTS. Usage: node evals/sim/phaseBLatency.sim.js [n=200]
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const { createBrainV2Live } = require('../../src/conversation/v2/liveTurn');
const DD0 = require('../v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId };
const N = Number(process.argv[2] || 200);
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const draftMs = () => Math.round(900 * Math.exp(0.35 * gauss()));
const underMs = () => Math.round(250 + 500 * rnd());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = ['I want to book window cleaning tomorrow at 2 PM.', 'Do you cover Kileleshwa?', 'Alvin.', 'Yes.'];

async function one(mode) {
  const env = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_V1_DRAFT_PHASE_B: 'on', BRAIN_V2_MODEL_ID: 'p', BRAIN_V2_MODEL_BACKUP_ID: 'b', BRAIN_V1_DRAFT_PHASE_B_PARALLEL: mode === 'serial' ? 'off' : 'on' };
  const memo = new Map(); const d = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
  const stream = () => async ({ request, onCall }) => { const c = request.contents.at(-1).parts[0].text.split('CALLER: ').pop(); await sleep(d(`d:${c}`, draftMs)); const x = { name: 'say', args: { text: 'Okay.', refs: [], kind: 'social' } }; onCall(x); return { calls: [x] }; };
  const tm = async (req) => { await sleep(d(`u:${JSON.stringify(req).length}`, underMs)); return { calls: [] }; };
  const live = createBrainV2Live({ env, applyTools: async () => ({ results: [{ ok: true, status: 'ok', id: 'r' }] }), v1DraftStreamFor: stream, shadowModel: tm, shadowBackupModel: tm, prewarm: false, now: () => new Date('2026-10-24T10:08:05Z'), log: () => {}, v1DraftSleep: (ms) => sleep(Math.min(ms, 5)), callerFile: { contactName: 'Alvin', nameConfirmed: false, openRows: [] } });
  const out = [];
  for (const text of T) {
    if (mode === 'parallel+partial') { try { live.partial({ text, profile: DD, langLock: 'en' }); } catch { /* */ } await sleep(Math.round(400 * rnd())); }
    const t0 = Date.now(); let first = null;
    await live.run({ text, profile: DD, langLock: 'en', onSentence: () => { if (first == null) first = Date.now() - t0; } });
    out.push(first == null ? Date.now() - t0 : first);
  }
  return out;
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
(async () => {
  for (const mode of ['serial', 'parallel', 'parallel+partial']) {
    seed = 7; const all = (await Promise.all(Array.from({ length: Math.ceil(N / T.length) }, () => one(mode)))).flat();
    console.log(`${mode.padEnd(17)} n=${all.length} p50=${pct(all, 0.5)}ms p90=${pct(all, 0.9)}ms max=${Math.max(...all)}ms`);
  }
})();
