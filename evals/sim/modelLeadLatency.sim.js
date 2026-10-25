'use strict';
// Simulated first-audio latency for BRAIN_MODEL_LEAD (no GEMINI_API_KEY on the build box).
// Runs the REAL runModelLead path (pack, hedge, understanding wait, machine, verifier) with a scripted model whose
// first-token time is sampled. Model timing assumptions are printed; first audio = endpoint/ASR + brain first sentence + TTS first chunk.
// usage: node evals/sim/modelLeadLatency.sim.js [turns=200]
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const { createBrainV2Live } = require('../../src/conversation/v2/liveTurn');
const DD0 = require('../v2/fixtures/tenants/done_and_dusted.json'); const DD = { ...DD0, id: DD0.tenantId };
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_V2_MODEL_ID: 'primary', BRAIN_V2_MODEL_BACKUP_ID: 'backup', BRAIN_CALL_CORE: 'on', BRAIN_MODEL_LEAD: 'on' };
const N = Number(process.argv[2] || 200);
// assumptions (ms). Primary TTFT: lognormal median 480, p90 ~1000 (25 Oct first sentences 620/741 ms incl. ASR tail);
// 3% primary failures; backup flash-lite median 380. Stream 48 chars / 25 ms. ASR final after endpoint 200; TTS first chunk 300.
const A = { primaryMedian: 480, primarySigma: 0.57, primaryFail: 0.03, backupMedian: 380, backupSigma: 0.45, chunkMs: 25, asr: 200, tts: 300 };
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
const logn = (med, sig) => med * Math.exp(sig * gauss());
const sleep = (ms, signal) => new Promise((r, j) => { const t = setTimeout(r, ms); signal && signal.addEventListener('abort', () => { clearTimeout(t); j(Object.assign(new Error('aborted'), { code: 'TIMEOUT' })); }, { once: true }); });
const TEXTS = ['I just wanted to know if you guys have Kilimani or Westlands', 'I wanted to make a booking for tomorrow at 2:00 PM at Kileleshwa for Carpet Cleaning. Is it okay?', 'Do you clean sofas?', 'Nilikuwa nataka kujua kama mnafika Kilimani au Westlands', 'Can you tell me my name?'];
async function one(i) {
  const fail = rnd() < A.primaryFail; const tp = logn(A.primaryMedian, A.primarySigma); const tb = logn(A.backupMedian, A.backupSigma);
  const streamFor = (id) => async ({ request, signal, onText }) => {
    const pack = JSON.parse(request.contents[0].parts[0].text); if (pack.wrong) { await sleep(250, signal); return { text: pack.fact }; }
    await sleep(id === 'primary' ? tp : tb, signal); if (id === 'primary' && fail) throw Object.assign(new Error('503'), { code: 'http_503' });
    const s = JSON.stringify({ understanding: { lang: 'en', intents: ['ask'], slots: { services: [], places: [] }, questions: [] }, tool_calls: [], reply: 'Sure, happy to help with that. What else can I do for you?' });
    for (let k = 0; k < s.length; k += 48) { onText(s.slice(k, k + 48)); await sleep(A.chunkMs, signal); }
    return { text: s };
  };
  const stages = [];
  const live = createBrainV2Live({ env: ENV, applyTools: async () => ({ results: [] }), modelLeadStreamFor: streamFor, v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date('2026-10-25T06:34:00Z'), log: () => {}, onModelStage: (s) => stages.push(s), callerFile: { contactName: 'Alvin', nameConfirmed: false, openRows: [] } });
  const t0 = Date.now(); let first = null;
  const r = await live.run({ text: TEXTS[i % TEXTS.length], profile: DD, langLock: i % TEXTS.length === 3 ? 'sw' : 'en', onSentence: () => { if (first == null) first = Date.now() - t0; } });
  const st = stages.find((s) => s.kind === 'model_lead') || {};
  return { brain: first ?? (Date.now() - t0), by: r.answeredBy, backup: (st.attempts || []).length > 1 };
}
(async () => {
  const out = []; for (let b = 0; b < N; b += 25) out.push(...await Promise.all(Array.from({ length: Math.min(25, N - b) }, (_, k) => one(b + k))));
  const fa = out.map((o) => o.brain + A.asr + A.tts).sort((a, b) => a - b); const pct = (p) => fa[Math.min(fa.length - 1, Math.floor(p * fa.length))];
  const br = out.map((o) => o.brain).sort((a, b) => a - b); const bp = (p) => br[Math.min(br.length - 1, Math.floor(p * br.length))];
  const tmpl = out.filter((o) => o.by === 'template').length;
  console.log(JSON.stringify({ turns: N, assumptions: A, brainFirstSentenceMs: { p50: bp(0.5), p90: bp(0.9), max: br[br.length - 1] }, firstAudioMs: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99) }, templateShare: +(tmpl / N).toFixed(3), backupFiredShare: +(out.filter((o) => o.backup).length / N).toFixed(3), gate_p90_le_2000: pct(0.9) <= 2000, gate_template_lt_5pct: tmpl / N < 0.05 }, null, 1));
})();
