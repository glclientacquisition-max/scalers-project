'use strict';
// BRAIN_MODEL_LEAD split path (understanding ∥ reply-first; one voice; lookup_caller receipt; multi-place; grace queue).
// Replays the 25 Oct staging calls: #933 HD_319eb6f7255d / HD_16e007c35ce9 and #932 HD_d17032973ceb / HD_507aadbfab10.
// The model is scripted (it proves the guards and the join rule, not model quality).
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const test = require('node:test');
const assert = require('node:assert');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const ML = require('../src/conversation/v2/modelLead');
const TT = require('../src/speech/turnTaking');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId, businessPolicies: { ...(DD0.businessPolicies || {}), payment: (DD0.businessPolicies && DD0.businessPolicies.payment) || 'M-Pesa Paybill, bank transfer or cash' } };
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_CALL_CORE: 'on', BRAIN_MODEL_LEAD: 'on', BRAIN_LEAD_MODEL_ID: 'lite', BRAIN_LEAD_BACKUP_MODEL_ID: 'flash' };
const NOW = '2026-10-25T07:24:00Z'; // 10:24 EAT (HD_319eb6f7255d)
const sleep = (ms, signal) => new Promise((r, j) => { const t = setTimeout(r, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); j(Object.assign(new Error('aborted'), { code: 'TIMEOUT' })); }, { once: true }); });
const U = (o = {}) => ({ lang: 'en', intents: [], questions: [], places: [], ...o });

/** understand(text) -> understanding | 'fail'; reply(pack) -> {reply, tool_calls} | 'fail'. ttft per kind/model. */
function harness({ understand = () => U(), reply = () => ({ reply: 'Sure. How else can I help?' }), callerFile = { contactName: null, callerPhone: '+254700000001', openRows: [] }, ttft = {} } = {}) {
  const T = { u_lite: 200, u_flash: 400, r_lite: 250, r_flash: 450, ...ttft };
  const stages = []; const applied = []; const calls = [];
  const streamFor = (id) => async ({ request, signal, onText }) => {
    const pack = JSON.parse(request.contents[0].parts[0].text);
    if (pack.wrong) { await sleep(20, signal); return { text: pack.fact }; }
    const kind = pack.UNDERSTAND ? 'u' : 'r'; calls.push(`${kind}_${id}`);
    await sleep(T[`${kind}_${id}`], signal);
    const out = kind === 'u' ? understand(pack.CALLER_SAID, id) : reply(pack, id);
    if (out === 'fail') throw Object.assign(new Error('gemini http 503'), { code: 'http_503' });
    const str = JSON.stringify(kind === 'u' ? out : { reply: out.reply, tool_calls: out.tool_calls || [] });
    for (let i = 0; i < str.length; i += 32) { if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'TIMEOUT' }); onText(str.slice(i, i + 32)); await sleep(5, signal); }
    return { text: str };
  };
  const applyTools = async (a) => { applied.push(a); const k = Object.keys(a)[0]; return { results: [{ action: k, ok: true, status: 'ok', id: `row_${applied.length}` }] }; };
  const live = createBrainV2Live({ env: ENV, applyTools, modelLeadStreamFor: streamFor, v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), shadowBackupModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date(NOW), log: () => {}, onModelStage: (s) => stages.push(s), callerFile });
  return { live, stages, applied, calls };
}
async function turn(h, text, langLock = 'en') {
  const said = []; const r = await h.live.run({ text, profile: DD, langLock, onSentence: (s) => said.push(s.text) });
  return { ...r, heard: said.join(' ') || r.line, stage: h.stages.filter((s) => s.kind === 'model_lead').slice(-1)[0] };
}
const count = (s, w) => (String(s).match(new RegExp(w, 'gi')) || []).length;
const down = { understand: () => 'fail', reply: () => 'fail' };
const ROWS = [
  { id: 'r26', kind: 'visit', service_name: 'Carpet Cleaning (per room)', window_start: '2026-10-26T11:00:00Z', address_landmark: 'Kileleshwa', status: 'scheduled' },
  { id: 'r30', kind: 'visit', service_name: 'Sofa Cleaning', window_start: '2026-10-30T07:00:00Z', address_landmark: 'Kilimani', status: 'scheduled' },
  { id: 'p13', kind: 'visit', service_name: 'Carpet Cleaning (per room)', window_start: '2026-10-13T07:00:00Z', address_landmark: 'Kitengela', status: 'scheduled' },
];
const ALVIN_FILE = { contactName: 'Alvin', nameConfirmed: false, callerPhone: '+254700000001', openRows: ROWS };

// ---------------- multi-place extraction (#933 c1 T2/T6/T8, #932 c2)
test('placeCandidates: every place, with or without or/and (Kilimani Westlands; Ongata Rongai or Kileleshwa; SW)', () => {
  assert.deepEqual(ML.placeCandidates('…do serve maybe. Kilimani Westlands, or maybe Kileleshwa.'), ['Kilimani', 'Westlands', 'Kileleshwa']);
  assert.deepEqual(ML.placeCandidates('serve Kilimani Westlands?'), ['Kilimani', 'Westlands']);
  assert.deepEqual(ML.placeCandidates('Ongata Rongai or Kileleshwa? Do you guys go there?'), ['Ongata Rongai', 'Kileleshwa']);
  assert.deepEqual(ML.placeCandidates('Mnafika Kilimani Westlands?'), ['Kilimani', 'Westlands']);
  assert.deepEqual(ML.placeCandidates('I want carpet cleaning tomorrow at 2'), []);
});

// ---------------- split + join rule + one voice
test('933-c1 T6 "serve Kilimani Westlands?": understanding LATE (1500 ms) never blocks the model reply; one voice; late understanding kept', async () => {
  const h = harness({ ttft: { u_lite: 1500, u_flash: 1600 }, understand: () => U({ intents: ['ask'], questions: [{ type: 'coverage' }], places: ['Kilimani', 'Westlands'] }), reply: () => ({ reply: 'Yes, we serve Kilimani and Westlands. Which service would you like?' }) });
  const r = await turn(h, 'Okay, I wanted to know if you guys serve Kilimani Westlands?');
  assert.match(r.answeredBy, /^model/, r.answeredBy);
  assert.ok(r.stage.firstSentenceMs < 1000, `first sentence ${r.stage.firstSentenceMs}`);
  assert.equal(count(r.heard, 'Kilimani'), 1, r.heard); assert.equal(count(r.heard, 'Westlands'), 1, r.heard); // no template echo
  assert.ok(!/we cover Kilimani\./.test(r.heard), r.heard);
});
test('join: understanding first (200 ms) -> machine uses it; reply streams after; ≤1 question', async () => {
  const h = harness({ understand: () => U({ intents: ['ask'], questions: [{ type: 'coverage' }], places: ['Kilimani', 'Westlands'] }), reply: () => ({ reply: 'Yes, we cover Kilimani and Westlands. Which service would you like?' }) });
  const r = await turn(h, 'Kilimani Westlands, do you go there');
  assert.match(r.answeredBy, /^model/); assert.ok(r.stage.stagesMs.understanding < 400, JSON.stringify(r.stage.stagesMs));
  assert.ok(count(r.heard, '\\?') <= 1, r.heard);
  assert.deepEqual(r.stage.receipts.coverage.map((c) => c.place).sort(), ['Kilimani', 'Westlands']);
});
test('933-c1 T2 all models down: template answers BOTH places, one line per subject, no contradiction', async () => {
  const h = harness(down);
  const r = await turn(h, 'I wanted to know if you guys do serve maybe. Kilimani Westlands, or maybe Kileleshwa.');
  assert.equal(r.answeredBy, 'template');
  for (const p of ['Kilimani', 'Westlands', 'Kileleshwa']) assert.ok(r.heard.includes(p), `${p}: ${r.heard}`);
  assert.ok(!/can'?t confirm/i.test(r.heard) || !/we cover/i.test(r.heard), r.heard);
});
test('933-c1 T5 template never states an unasked price', async () => {
  const h = harness(down);
  const r = await turn(h, 'Inquiring if you guys maybe do carpet cleaning,');
  assert.doesNotMatch(r.heard, /shilling|KES|ksh|\b\d,?\d{3}\b/i, r.heard);
});
test('933-c1 T12 crypto payment: KB answer or honest unknown, never "Sorry, I\'m not getting that"', async () => {
  for (const mode of ['down', 'model']) {
    const h = mode === 'down' ? harness(down) : harness({ understand: () => U({ intents: ['ask'], questions: [{ type: 'payment', subject: 'crypto' }] }), reply: () => ({ reply: 'Good question.' }) });
    const r = await turn(h, 'Okay, I wanted to know if you guys accept crypto payments?');
    assert.doesNotMatch(r.heard, /not getting that/i, `${mode}: ${r.heard}`);
    assert.match(r.heard, /crypto|m-?pesa|paybill|cash|bank/i, `${mode}: ${r.heard}`);
  }
});
test('933-c1 T8 "Ongata Rongai or Kileleshwa?" (the dead-air turn) gets one answer per place', async () => {
  const h = harness({ understand: () => 'fail', reply: () => ({ reply: 'Let me check.' }) });
  const r = await turn(h, 'And what about Ongata Rongai or Kileleshwa? Do you guys go there?');
  assert.ok(r.heard.includes('Ongata Rongai') && r.heard.includes('Kileleshwa'), r.heard);
});

// ---------------- lookup_caller receipt tool (#933 c2 reschedule loop)
test('lookup_caller: in-memory receipt <10 ms; upcoming ≤3 future only; past read-only; unique/candidates/none', () => {
  const now = new Date(NOW); const file = { ...ALVIN_FILE, notes: ['Gate code 44'] };
  const all = ML.lookupCaller(file, {}, { now });
  assert.ok(all.ms < 10); assert.equal(all.tool, 'lookup_caller'); assert.ok(all.receipt_id);
  assert.deepEqual(all.upcoming.map((u) => u.id), ['r26', 'r30']); assert.equal(all.upcoming[0].time, '14:00');
  assert.deepEqual(all.past_jobs.map((p) => p.id), ['p13']); assert.ok(all.past_jobs.every((p) => p.read_only));
  assert.equal(all.match.kind, 'candidates'); assert.equal(all.name, null); assert.equal(all.candidate, 'Alvin');
  assert.deepEqual(all.notes, ['Gate code 44']); assert.ok(all.addresses.includes('Kileleshwa'));
  assert.equal(ML.lookupCaller(file, { service: 'Carpet Cleaning' }, { now }).match.row_id, 'r26'); // past 13 Oct carpet is never a target
  assert.equal(ML.lookupCaller(file, { service: 'Window Cleaning' }, { now }).match.kind, 'none');
  assert.equal(ML.lookupCaller(file, { date: '2026-10-30' }, { now }).match.row_id, 'r30');
});
test('933-c2 reschedule: no "Which booking is it?" loop — offers the upcoming by name, then a unique match moves on', async () => {
  const h = harness({ callerFile: ALVIN_FILE, understand: () => 'fail', reply: () => 'fail' });
  const r1 = await turn(h, 'I want to reschedule my booking.');
  assert.doesNotMatch(r1.heard, /Which booking is it|service and the day/i, r1.heard);
  assert.match(r1.heard, /carpet cleaning/i, r1.heard); assert.match(r1.heard, /sofa/i, r1.heard);
  assert.doesNotMatch(r1.heard, /13 October|Kitengela/i, 'past job never offered');
  const r2 = await turn(h, 'It was carpet cleaning. You have it in your memory.');
  assert.doesNotMatch(r2.heard, /Which booking|Which one/i, r2.heard);
  assert.equal(h.live.getState().slots.row && h.live.getState().slots.row.id, 'r26');
});
test('933-c2 T4 caller-file sentence passes as proof (descriptive); past job as open and write claims still blocked', async () => {
  const say = { t: '' };
  const h = harness({ callerFile: ALVIN_FILE, understand: () => U({ intents: ['reschedule'], booking_ref: { service: 'carpet cleaning' } }), reply: () => ({ reply: say.t }) });
  say.t = 'You have a carpet cleaning scheduled for Monday 26 October in Kileleshwa. What new day works for you?';
  const r = await turn(h, 'I want to reschedule my carpet cleaning.');
  assert.match(r.heard, /carpet cleaning scheduled for Monday 26 October/i, JSON.stringify(r.stage.verdicts));
  say.t = 'You have a carpet cleaning on 13 October in Kitengela.';
  const r2 = await turn(h, 'When is my booking?');
  assert.doesNotMatch(r2.heard, /13 October/i, r2.heard);
  say.t = "I've cancelled your carpet cleaning on Monday 26 October.";
  const r3 = await turn(h, 'Okay.');
  assert.doesNotMatch(r3.heard, /cancelled/i, r3.heard);
});

// ---------------- name (decision 5; #932 c1 T4)
test('932-c1 T4 "Can you tell me my name?": candidate only as a question; never stated as fact', async () => {
  const h = harness({ callerFile: ALVIN_FILE, understand: () => U({ intents: ['ask'], questions: [{ type: 'identity' }] }), reply: () => ({ reply: "You're Alvin." }) });
  const r = await turn(h, 'Can you tell me my name?');
  assert.doesNotMatch(r.heard, /You're Alvin\.|your name is Alvin/i, r.heard);
  assert.match(r.heard, /Alvin\?|Is that you\?/i, r.heard);
});
test('932-c2 "I wanted to know if you guys have Kilimani or Westlands." (no "?") answered per place, no "can\'t confirm" stack', async () => {
  const h = harness({ understand: () => U({ intents: ['ask'], questions: [{ type: 'coverage' }], places: ['Kilimani', 'Westlands'] }), reply: () => ({ reply: 'Yes, we cover Kilimani and Westlands.' }) });
  const r = await turn(h, 'I wanted to know if you guys have Kilimani or Westlands.');
  assert.ok(r.heard.includes('Kilimani') && r.heard.includes('Westlands'), r.heard);
  assert.doesNotMatch(r.heard, /can'?t confirm/i, r.heard);
});
test('SW: "Mnafika Kilimani Westlands?" -> Swahili reply covering both (split path)', async () => {
  const h = harness({ understand: () => U({ lang: 'sw', intents: ['ask'], questions: [{ type: 'coverage' }], places: ['Kilimani', 'Westlands'] }), reply: () => ({ reply: 'Ndio, tunafika Kilimani na Westlands. Ungependa huduma gani?' }) });
  const r = await turn(h, 'Mnafika Kilimani Westlands?', 'sw');
  assert.match(r.heard, /tunafika/); assert.ok(r.heard.includes('Westlands'));
});
test('SW all models down: template answers both places in Swahili, no unasked price', async () => {
  const h = harness(down);
  const r = await turn(h, 'Nilikuwa nataka kujua kama mnafika Kilimani au Westlands', 'sw');
  assert.ok(r.heard.includes('Kilimani') && r.heard.includes('Westlands'), r.heard);
  assert.doesNotMatch(r.heard, /shilling|bei ni/i, r.heard);
});
test('flag: BRAIN_MODEL_LEAD_SPLIT=off restores the #933 single call; lead models are configurable', () => {
  assert.equal(ML.splitOn({ env: {} }), true); assert.equal(ML.splitOn({ env: { BRAIN_MODEL_LEAD_SPLIT: 'off' } }), false);
  assert.deepEqual(ML.leadModels({}), { primary: 'gemini-3.5-flash-lite', backup: 'gemini-3.6-flash' });
  assert.equal(ML.leadModels({ BRAIN_LEAD_MODEL_ID: 'x' }).primary, 'x');
});

// ---------------- turn-taking (HD_319eb6f7255d 5.75 s dead air) — Voice review
test('grace window: a real caller sentence is queued (not dropped) under BRAIN_MODEL_LEAD; backchannel still ignored; flag off unchanged', () => {
  const prev = { ...process.env };
  try {
    const at = { phase: 'speaking', speakStartedAt: 1000, now: 1100, isFinal: true };
    process.env.BRAIN_MODEL_LEAD = 'on'; delete process.env.VOICE_GRACE_QUEUE;
    const d = TT.decideCallerEvent({ ...at, text: 'Rongai or Kileleshwa?' });
    assert.equal(d.action, 'queue'); assert.equal(d.reason, 'grace_queued'); assert.equal(d.skip, false);
    assert.equal(TT.decideCallerEvent({ ...at, text: 'okay' }).action, 'ignore');
    process.env.VOICE_GRACE_QUEUE = 'off'; assert.equal(TT.decideCallerEvent({ ...at, text: 'Rongai or Kileleshwa?' }).reason, 'grace');
    delete process.env.VOICE_GRACE_QUEUE; process.env.BRAIN_MODEL_LEAD = 'off';
    assert.equal(TT.decideCallerEvent({ ...at, text: 'Rongai or Kileleshwa?' }).reason, 'grace');
  } finally { for (const k of ['BRAIN_MODEL_LEAD', 'VOICE_GRACE_QUEUE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
});
