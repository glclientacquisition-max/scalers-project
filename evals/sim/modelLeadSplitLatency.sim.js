'use strict';
// SIMULATION (not a live measurement): first-audio latency of the BRAIN_MODEL_LEAD split path, driven by the REAL
// runModelLead (lookup_caller, coverage, two parallel hedged calls, join rule, machine, verifier) with model timings
// sampled from what staging MEASURED on the #933 dials (voice-qa/2026-10-25_933-dials-score.md, 11 turns):
//  - flash-lite TTFT after its own start: 616-885 ms (backup started at 900, first tokens 1516-1785) -> empirical set below
//  - gemini-3.6-flash TTFT: 1182 / 1761 ms on 2/11; 7/11 no token by 1800 (deadline), 1 invalid_json -> modelled as 64% "> 1800"
//  - pipeline overhead (ASR final -> brain start, TTS first chunk): first audio minus brain on template turns = 206..679 ms
// Those TTFTs came with the big #933 prompt/schema; the trimmed reply prompt may be faster, the sim does NOT assume that.
// usage: node evals/sim/modelLeadSplitLatency.sim.js [turns=200]
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const { createBrainV2Live } = require('../../src/conversation/v2/liveTurn');
const DD0 = require('../v2/fixtures/tenants/done_and_dusted.json'); const DD = { ...DD0, id: DD0.tenantId };
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_CALL_CORE: 'on', BRAIN_MODEL_LEAD: 'on', BRAIN_LEAD_MODEL_ID: 'lite', BRAIN_LEAD_BACKUP_MODEL_ID: 'flash' };
const N = Number(process.argv[2] || 200);
const LITE_TTFT = [616, 640, 662, 700, 746, 781, 803, 846, 885]; // 933 dials, flash-lite first token minus its 900 ms start
const FLASH = { okShare: 0.36, ttft: [1182, 1761] };
const OVERHEAD = [206, 214, 239, 290, 299, 337, 349, 416, 602, 609, 679]; // 933: first audio - 1800 ms brain hard stop
const CHUNK = { chars: 48, ms: 25 };
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)] * (0.95 + rnd() * 0.1);
const sleep = (ms, signal) => new Promise((r, j) => { const t = setTimeout(r, ms); signal && signal.addEventListener('abort', () => { clearTimeout(t); j(Object.assign(new Error('aborted'), { code: 'TIMEOUT' })); }, { once: true }); });
const TEXTS = [['I wanted to know if you guys serve Kilimani Westlands', 'en'], ['Inquiring if you guys maybe do carpet cleaning', 'en'], ['I want to reschedule my booking', 'en'], ['Nilikuwa nataka kujua kama mnafika Kilimani au Westlands', 'sw'], ['Can you tell me my name?', 'en'], ['Do you accept crypto payments?', 'en']];
const ROWS = [{ id: 'r26', kind: 'visit', service_name: 'Carpet Cleaning (per room)', window_start: '2026-10-26T11:00:00Z', address_landmark: 'Kileleshwa', status: 'scheduled' }];
async function one(i) {
  const streamFor = (id) => async ({ request, signal, onText }) => {
    const pack = JSON.parse(request.contents[0].parts[0].text); if (pack.wrong) { await sleep(300, signal); return { text: pack.fact }; }
    const ttft = id === 'lite' ? pick(LITE_TTFT) : rnd() < FLASH.okShare ? pick(FLASH.ttft) : 2500;
    await sleep(ttft, signal);
    const s = pack.UNDERSTAND ? JSON.stringify({ lang: 'en', intents: ['ask'], questions: [], places: [] }) : JSON.stringify({ reply: 'Sure, happy to help with that. What else can I do for you?', tool_calls: [] });
    for (let k = 0; k < s.length; k += CHUNK.chars) { onText(s.slice(k, k + CHUNK.chars)); await sleep(CHUNK.ms, signal); }
    return { text: s };
  };
  const stages = [];
  const live = createBrainV2Live({ env: ENV, applyTools: async () => ({ results: [] }), modelLeadStreamFor: streamFor, v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date('2026-10-25T07:24:00Z'), log: () => {}, onModelStage: (s) => stages.push(s), callerFile: { contactName: 'Alvin', nameConfirmed: false, openRows: ROWS } });
  const [text, lang] = TEXTS[i % TEXTS.length];
  const t0 = Date.now(); let first = null;
  const r = await live.run({ text, profile: DD, langLock: lang, onSentence: () => { if (first == null) first = Date.now() - t0; } });
  return { brain: first ?? (Date.now() - t0), overhead: pick(OVERHEAD), by: r.answeredBy };
}
(async () => {
  const out = []; for (let b = 0; b < N; b += 25) out.push(...await Promise.all(Array.from({ length: Math.min(25, N - b) }, (_, k) => one(b + k))));
  const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return Math.round(a[Math.min(a.length - 1, Math.floor(p * a.length))]); };
  const fa = out.map((o) => o.brain + o.overhead); const br = out.map((o) => o.brain);
  const tmpl = out.filter((o) => /^template/.test(o.by)).length;
  console.log(JSON.stringify({ SIMULATION: true, turns: N, source: '933 dials measured TTFT/overhead', brainFirstSentenceMs: { p50: q(br, 0.5), p90: q(br, 0.9) }, firstAudioMs: { p50: q(fa, 0.5), p90: q(fa, 0.9), p99: q(fa, 0.99) }, templateShare: +(tmpl / N).toFixed(3), byPath: out.reduce((m, o) => ((m[o.by] = (m[o.by] || 0) + 1), m), {}), gate_p90_le_2000: q(fa, 0.9) <= 2000 }, null, 1));
})();
