'use strict';
// BRAIN_MODEL_LEAD: one structured model call leads every turn; code owns state and guards.
// Spec ship-briefs/2026-10-25_brain_model-led-call-core-spec.md §8 — 20 cases (25 Oct calls HD_d17032973ceb /
// HD_507aadbfab10, prior problem calls, 6 Swahili/mixed). The model is scripted (JSON streamed in chunks with a
// first-token delay); the booking executor is the REAL validateCreateAppointment (so G5 sees what the DB would get).
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const test = require('node:test');
const assert = require('node:assert');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const ML = require('../src/conversation/v2/modelLead');
const CC = require('../src/conversation/v2/callCore');
const TX = require('../src/conversation/toolExecution');
const { clockPhrase } = require('../src/conversation/visitTime');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId };
const BASE = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_V2_MODEL_ID: 'primary', BRAIN_V2_MODEL_BACKUP_ID: 'backup', BRAIN_CALL_CORE: 'on' };
// The same case set runs twice: #933 single call (this file) and the split path (tests/brainModelLeadSplit.test.js sets BRAIN_LEAD_CASES_SPLIT=on).
const SPLIT = process.env.BRAIN_LEAD_CASES_SPLIT === 'on';
const ENV = { ...BASE, BRAIN_MODEL_LEAD: 'on', BRAIN_MODEL_LEAD_SPLIT: SPLIT ? 'on' : 'off', BRAIN_LEAD_MODEL_ID: 'primary', BRAIN_LEAD_BACKUP_MODEL_ID: 'backup' };
const NOW = '2026-10-25T06:34:00Z'; // 09:34 EAT, the time of HD_d17032973ceb
const sleep = (ms, signal) => new Promise((r, j) => { const t = setTimeout(r, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); j(Object.assign(new Error('aborted'), { code: 'TIMEOUT' })); }, { once: true }); });

/** A scripted model: script(pack, modelId) -> {understanding, tool_calls, reply} | 'fail'. */
function harness({ script = defaultModel, env = ENV, callerFile = { contactName: null, callerPhone: '+254700000001', openRows: [] }, ttft = { primary: 40, backup: 30 }, deadlines } = {}) {
  const applied = []; const stages = []; const calls = { primary: 0, backup: 0 };
  const modelLeadStreamFor = (id) => async ({ request, signal, onText }) => {
    const pack = JSON.parse(request.contents[0].parts[0].text);
    if (pack.wrong) { await sleep(20, signal); return { text: pack.fact }; } // repair model: says the fact
    if (pack.UNDERSTAND) { // split path: the understanding call gets the same scripted understanding
      await sleep(typeof ttft[id] === 'function' ? ttft[id]() : ttft[id], signal);
      const o = script({ CALLER_SAID: pack.CALLER_SAID, PLAN: {}, CALLER: {}, RECEIPTS: { coverage: [] }, HISTORY: [], LANG_HINT: null }, id);
      if (o === 'fail') throw Object.assign(new Error('gemini http 503'), { status: 503, code: 'http_503' });
      return { text: JSON.stringify(o.understanding || {}) };
    }
    calls[id] = (calls[id] || 0) + 1;
    await sleep(typeof ttft[id] === 'function' ? ttft[id]() : ttft[id], signal);
    const out = script(pack, id);
    if (out === 'fail') throw Object.assign(new Error('gemini http 503'), { status: 503, code: 'http_503' });
    const str = JSON.stringify({ understanding: out.understanding || {}, tool_calls: out.tool_calls || [], reply: out.reply || '' });
    for (let i = 0; i < str.length; i += 48) { if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'TIMEOUT' }); onText(str.slice(i, i + 48)); await sleep(2, signal); }
    return { text: str };
  };
  const applyTools = async (a) => {
    applied.push(a);
    if (a.appointment) {
      const v = TX.validateCreateAppointment(a.appointment, { hoursSchedule: DD.hoursSchedule, now: new Date(NOW), businessPolicies: DD.businessPolicies });
      return { results: [{ action: 'create_appointment', status: v.valid ? 'succeeded' : 'invalid', id: `appt_${applied.length}`, value: v.value }] };
    }
    if (a.appointmentUpdate) return { results: [{ action: 'update_appointment', status: 'succeeded', id: a.appointmentUpdate.appointmentId, value: a.appointmentUpdate }] };
    const k = Object.keys(a)[0]; return { results: [{ action: k, ok: true, status: 'ok', id: `row_${applied.length}` }] };
  };
  const live = createBrainV2Live({ env, applyTools, modelLeadStreamFor, ...(deadlines ? { modelLeadDeadlines: deadlines } : {}), v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), shadowBackupModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date(NOW), log: () => {}, onModelStage: (s) => stages.push(s), callerFile });
  return { live, applied, stages, calls };
}
const { assertTurnSpeech } = require('./helpers/turnInvariants');
async function turn(h, text, langLock = 'en', extra = {}) {
  if (process.env.DBG) process.on("exit", () => {}); const said = []; const r = await h.live.run({ text, profile: DD, langLock, onSentence: (s) => said.push(s.text), ...extra });
  const out = { ...r, heard: said.join(' ') || r.line, sentences: r.sentences || [], stage: h.stages.filter((s) => s.kind === 'model_lead').slice(-1)[0] };
  if (out.sentences.length) assertTurnSpeech(out);
  return out;
}
const qs = (s) => (String(s).match(/\?/g) || []).length;
const U = (o = {}) => ({ lang: 'en', intents: [], slots: { services: [], places: [] }, questions: [], ...o });
/** default model: words the plan's next step, answers nothing it was not told. */
function defaultModel(pack) {
  const swl = pack.LANG_HINT === 'sw';
  const ask = { service: swl ? 'Ungependa huduma gani?' : 'Which service would you like?', place: swl ? 'Tukuje wapi?' : 'Where should we come?', date: swl ? 'Siku gani?' : 'Which day works for you?', time: swl ? 'Saa ngapi?' : 'What time suits you?', name: swl ? 'Niweke kwa jina gani?' : 'What name should I put it under?' }[pack.PLAN.next] || (swl ? 'Nikusaidie na nini kingine?' : 'How else can I help?');
  return { understanding: U({ lang: swl ? 'sw' : 'en' }), reply: `${swl ? 'Sawa.' : 'Sure.'} ${ask}` };
}
const results = []; // gate rollup across cases
function score(name, r, { receipts = null } = {}) {
  const st = r.stage || {};
  const writesOk = (st.receipts && st.receipts.writes || []).filter((w) => w.ok).length;
  const unbacked = CC.CLAIM.test(r.heard) && !writesOk && !(receipts || 0);
  const places = (st.receipts && st.receipts.coverage || []).map((c) => c.place);
  // contradiction = one place gets both a yes and a no/unsure answer (G4)
  const YES = /\b(yes|we (?:do )?cover|we (?:can )?come|tunafika|ndio)\b/i; const NO = /\b(don'?t|do not|not|can'?t confirm|hatufiki|sorry)\b/i;
  const contradiction = places.some((p) => { const ss = r.heard.split(/(?<=[.!?])\s+/).filter((x) => x.includes(p)); return ss.some((x) => YES.test(x) && !NO.test(x)) && ss.some((x) => NO.test(x) && !/\?\s*$/.test(x)); });
  results.push({ name, answeredBy: r.answeredBy, firstMs: st.firstSentenceMs, unbacked, contradiction });
  return { unbacked, contradiction };
}

const ALVIN = { contactName: 'Alvin', nameConfirmed: false, callerPhone: '+254700000001', openRows: [] };
const C1T3 = 'I wanted to make a booking for tomorrow at 2:00 PM at Kileleshwa for Carpet Cleaning. Is it okay?';
const c1t3Model = (pack) => /Kileleshwa/.test(pack.CALLER_SAID) && /Carpet/.test(pack.CALLER_SAID)
  ? { understanding: U({ intents: ['book', 'ask'], slots: { services: ['Carpet Cleaning (per room)'], date: '2026-10-26', time: '14:00', places: ['Kileleshwa'] }, questions: [{ type: 'coverage', subject: 'Kileleshwa' }] }), reply: 'Carpet cleaning starts at 2,200 shillings per room. Yes, we cover Kileleshwa. Shall I put it under Alvin?' }
  : defaultModel(pack);


// ---------------- 25 Oct calls
async function bookC1(h) {
  await turn(h, C1T3);
  await turn(h, 'Yes, it is Alvin.');
  let r = await turn(h, 'Yes, do so.');
  if (h.live.getState().phase === 'readback') r = await turn(h, 'Yeah, yeah, do so.');
  return r;
}
test('4 C1-T7 "No." -> goodbye worded by the model', async () => {
  const h = harness({ script: (p) => p.CALLER_SAID === 'No.' ? { understanding: U({ intents: ['deny', 'goodbye'] }), reply: 'Alright, thanks for calling Done and Dusted. Have a lovely day!' } : c1t3Model(p), callerFile: ALVIN });
  await turn(h, C1T3);
  const r = await turn(h, 'No.');
  assert.match(r.answeredBy, /^model/); assert.match(r.heard, /thanks for calling|lovely day/i);
  score('4', r);
});
test('7 returning caller: name only if confirmed; last job = PAST; upcoming <= 3 open future, sorted (33 rows)', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ id: `p${i}`, job: 'Sofa Cleaning (per seat)', window_start: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T07:00:00Z`, status: 'requested', past: true });
  for (let i = 0; i < 13; i++) rows.push({ id: `f${i}`, job: 'Carpet Cleaning (per room)', window_start: `2026-11-${String(10 - (i % 9)).padStart(2, '0')}T07:00:00Z`, status: 'requested' });
  const h = harness({ callerFile: { contactName: 'Alvin', nameConfirmed: false, callerPhone: '+254700000001', openRows: rows } });
  const file = { contactName: 'Alvin', nameConfirmed: false, openRows: rows.map((r) => ({ ...r, service_name: r.job })) };
  const rec = ML.callerReceipt(file, { now: new Date(NOW) });
  assert.equal(rec.name, null); assert.equal(rec.candidate, 'Alvin');
  assert.equal(rec.upcoming.length, 3); assert.equal(rec.upcoming_count, 13);
  assert.ok(rec.upcoming[0].date <= rec.upcoming[1].date && rec.upcoming[1].date <= rec.upcoming[2].date);
  assert.equal(rec.last_past_job.date, '2026-10-20');
  const rec2 = ML.callerReceipt({ ...file, nameConfirmed: true }, { now: new Date(NOW) });
  assert.equal(rec2.name, 'Alvin');
  assert.equal(ML.openingLine({ contactName: 'Alvin', nameConfirmed: true }), 'Welcome back, Alvin. How can I help today?');
  assert.equal(ML.openingLine({ contactName: 'Alvin', nameConfirmed: false }), 'Hello, am I speaking with Alvin?');
});
// ---------------- prior problem calls
test('13 barge-in during sentence 1: nothing more is spoken, no write', async () => {
  const h = harness({ script: c1t3Model, callerFile: ALVIN });
  let n = 0; const said = [];
  const r = await h.live.run({ text: C1T3, profile: DD, langLock: 'en', onSentence: (s) => { said.push(s.text); n += 1; }, shouldAbort: () => n >= 1 });
  assert.ok(said.length <= 1, said.join(' | ')); assert.equal(h.applied.filter((a) => a.appointment).length, 0); void r;
});
// ---------------- Swahili / mixed
test('16 SW "kesho saa nane mchana Kileleshwa" -> 14:00, SW read-back from state', async () => {
  const h = harness({ script: (p) => ({ understanding: U({ lang: 'sw', intents: ['book'], slots: { services: ['Carpet Cleaning (per room)'], time: '14:00', places: ['Kileleshwa'] } }), reply: p.PLAN.next === 'name' ? 'Sawa. Niweke kwa jina gani?' : 'Sawa.' }) });
  await turn(h, 'Nataka kubook carpet cleaning kesho saa nane mchana Kileleshwa', 'sw');
  const st = h.live.getState(); assert.equal(st.slots.when.time, '14:00'); assert.equal(st.slots.when.date, '2026-10-26');
  const r = await turn(h, 'Alvin.', 'sw');
  assert.match(r.heard, /saa nane|Jumatatu/i, r.heard);
  score('16', r);
});
test('18 SW "Jina langu ni nani?" -> name answer (confirmed file name)', async () => {
  const h = harness({ callerFile: { contactName: 'Alvin', nameConfirmed: true, callerPhone: '+254700000001', openRows: [] }, script: () => ({ understanding: U({ lang: 'sw', questions: [{ type: 'identity' }] }), reply: 'Unaitwa Alvin. Nikusaidie na nini?' }) });
  const r = await turn(h, 'Jina langu ni nani?', 'sw');
  assert.match(r.heard, /Alvin/); score('18', r);
});
test('19 SW "Hapana, asante" -> SW goodbye by the model', async () => {
  const h = harness({ script: () => ({ understanding: U({ lang: 'sw', intents: ['deny', 'goodbye'] }), reply: 'Sawa, asante kwa kupiga simu. Kwaheri!' }) });
  const r = await turn(h, 'Hapana, asante', 'sw');
  assert.match(r.heard, /asante|kwaheri/i); assert.match(r.answeredBy, /^model/); score('19', r);
});

test('unit: partial JSON reader yields understanding before the reply and streams sentences', () => {
  const s = JSON.stringify({ understanding: { lang: 'en', questions: [{ type: 'coverage' }] }, tool_calls: [], reply: 'Yes, we cover Kilimani. Which day?' });
  const p1 = ML.partialParse(s.slice(0, s.indexOf('"reply"') + 12));
  assert.equal(p1.understanding.lang, 'en'); assert.equal(p1.replyClosed, false);
  const p2 = ML.partialParse(s); assert.equal(p2.reply, 'Yes, we cover Kilimani. Which day?'); assert.equal(p2.replyClosed, true);
  assert.deepEqual(ML.sentencesOf('Yes, we cover Kilimani. Which d', false), ['Yes, we cover Kilimani.']);
  assert.deepEqual(ML.placeCandidates('do you have Kilimani or Westlands'), ['Kilimani', 'Westlands']);
  assert.equal(ML.storedWhenText({ date: '2026-10-26', time: '14:00' }), '2026-10-26 2:00 PM');
});

test('GATES over the case set: template share <5%, 0 unbacked claims, 0 contradictions', () => {
  const live = results.filter((r) => r.answeredBy);
  const tmpl = live.filter((r) => r.answeredBy === 'template' && r.name !== '14').length; // case 14 forces all-models-down
  assert.ok(tmpl / live.length < 0.05, `template share ${tmpl}/${live.length} ${JSON.stringify(live.filter((r) => r.answeredBy === 'template').map((r) => r.name))}`);
  assert.equal(live.filter((r) => r.unbacked).length, 0, JSON.stringify(live.filter((r) => r.unbacked)));
  assert.equal(live.filter((r) => r.contradiction).length, 0, JSON.stringify(live.filter((r) => r.contradiction)));
});
