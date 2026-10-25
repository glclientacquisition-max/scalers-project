'use strict';
// HD_6d4e7863db76 (staging 924878f6, 25 Oct 14:23 EAT) double replies: one reply owner, single-emit latch, resume carry, price gate keeps the yes.
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
const OW = require('../src/conversation/v2/owed');

test('T1 agent-name question ("unaitwa aje?"): persona answers, no "Sina jina lako", exactly one question at the end', async () => {
  const h = harness({ understand: () => U({ lang: 'sw', intents: ['ask'], questions: [{ type: 'identity', subject: 'name' }] }), reply: () => ({ reply: 'Habari, mimi naitwa Shy kutoka Done and Dusted. Nikusaidie namna gani leo?' }) });
  const r = await turn(h, 'Habari yako, unaitwa aje?', 'sw');
  assert.ok(!/Sina jina lako/.test(r.heard), r.heard);
  assert.equal(count(r.heard, '\\?'), 1, r.heard); assert.match(r.heard, /\?\s*$/);
});
test('identity subject split: agent name vs caller name', () => {
  assert.equal(OW.identitySubject({ subject: 'name' }, 'Habari yako, unaitwa aje?'), 'agent_name');
  assert.equal(OW.identitySubject({ subject: 'name' }, "What's your name?"), 'agent_name');
  assert.equal(OW.identitySubject({ subject: 'name' }, 'Do you know my name?'), 'caller_name');
  assert.equal(OW.identitySubject({ subject: 'name' }, 'Jina langu ni nani kwenye file?'), 'caller_name');
  assert.equal(OW.render({ topic: 'agent_name', lang: 'sw' }, { profile: DD }), 'Naitwa Shy.');
  assert.equal(OW.render({ topic: 'agent_name', lang: 'en' }, { profile: DD }), "I'm Shy.");
});
test('owed answers already covered by the model draft are dropped (price), never appended after the reply', async () => {
  const h = harness({ understand: () => U({ intents: ['ask'], questions: [{ type: 'price' }] }), reply: () => ({ reply: 'Deep cleaning ni KSh 3,000 hadi 6,000. Ungependa nikuwekee miadi?' }) });
  const r = await turn(h, 'Deep cleaning ni bei gani?', 'sw');
  assert.equal(count(r.heard, '3,000|elfu tatu'), 1, r.heard);
  assert.match(r.heard, /\?\s*$/, 'step question is last');
});
test('latch + fragment: "like." then "Do you guys do it?" asks the booking question once', async () => {
  const h = harness({ understand: () => U({ intents: ['ask'], questions: [] }), reply: () => ({ reply: 'Ndiyo, tunatoa huduma ya usafi wa kina. Ungependa nikuwekee miadi?' }) });
  const a = await turn(h, 'like.', 'sw'); const b = await turn(h, 'Do you guys do it?', 'sw');
  assert.equal(count(`${a.heard} ${b.heard}`, 'Ungependa nikuwekee miadi'), 1, `${a.heard} || ${b.heard}`);
});
test('latch: the caller answering the question lets it be asked again later; a genuine re-ask is allowed', async () => {
  const h = harness({ reply: () => ({ reply: 'Deep Clean costs between 3,000 and 6,000 shillings. Would you like me to book it for you?' }), understand: () => U({ intents: ['ask'], questions: [{ type: 'price' }] }) });
  const a = await turn(h, 'How much is deep cleaning? How much?'); const b = await turn(h, 'How much is deep cleaning?');
  assert.match(a.heard, /3,000/); assert.match(b.heard, /3,000/, 'the repeated price answer is legit (D3)');
  const c = await turn(h, 'Yes, how much is deep cleaning again?');
  assert.match(c.heard, /book it for you\?/, 'a reply word re-opens the question');
});
test('reconnect: resumed stream continues the v2 machine at T11 as Alvin, no re-greet, language kept', async () => {
  const h = harness({ callerFile: ALVIN_FILE, understand: (t) => U({ lang: /Sawa|Habari|naitwa/.test(t) ? 'sw' : 'en' }), reply: (p) => ({ reply: /Sawa/.test(p.CALLER_SAID || '') ? 'Sawa Alvin. Nikusaidie na nini kingine?' : 'Sure. How else can I help?' }) });
  await turn(h, 'Habari, naitwa Alvin.', 'sw');
  for (let i = 0; i < 9; i += 1) await turn(h, `question ${i}`);
  const st = h.live.getState(); const before = st.turn;
  const stages2 = [];
  const h2 = createBrainV2Live({ env: ENV, resumeState: st, applyTools: async () => ({ results: [] }), modelLeadStreamFor: () => async ({ request, onText }) => { const pack = JSON.parse(request.contents[0].parts[0].text); const out = pack.UNDERSTAND ? U({ lang: 'sw' }) : { reply: 'Sawa Alvin. Nikusaidie na nini kingine?' }; const s = JSON.stringify(out); onText(s); return { text: s }; }, v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), shadowBackupModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date(NOW), log: () => {}, onModelStage: (s) => stages2.push(s), callerFile: ALVIN_FILE });
  const said = []; const r = await h2.run({ text: 'Sawa.', profile: DD, langLock: null, onSentence: (s) => said.push(s.text) });
  const st2 = h2.getState();
  assert.strictEqual(st2, st, 'same machine object');
  assert.equal(st2.turn, before + 1, `turn ${st2.turn}`);
  const heard = said.join(' ') || r.line;
  assert.ok(!/Welcome to Done and Dusted|Karibu/i.test(heard), heard);
  assert.ok(!/How can I help/i.test(heard), `Swahili caller answered in Swahili: ${heard}`);
});
test('price gate keeps the yes: "Ndiyo, tunafanya deep cleaning, KSh 6,000" with price unasked', () => {
  assert.equal(ML.yesClause('Ndiyo, tunafanya deep cleaning, bei ni KSh 6,000 hadi 12,000.'), 'Ndiyo, tunafanya deep cleaning.');
  assert.equal(ML.yesClause('Yes, we do deep cleaning and it costs KSh 6,000.'), 'Yes, we do deep cleaning.');
  assert.equal(ML.yesClause('Deep cleaning costs KSh 6,000.'), null);
  assert.equal(ML.yesClause('Ndiyo, KSh 6,000.'), null);
});
test('price gate end-to-end: "do you do deep cleaning?" keeps "Ndiyo, tunafanya" when the price clause is dropped', async () => {
  const h = harness({ understand: () => U({ lang: 'sw', intents: ['ask'], questions: [] }), reply: () => ({ reply: 'Ndiyo, tunafanya deep cleaning, bei ni KSh 6,000 hadi 12,000. Ungependa nikuwekee miadi?' }) });
  const r = await turn(h, 'Ah, nataka kujua if you guys can do Deep Cleaning.', 'sw');
  assert.match(r.heard, /Ndiyo, tunafanya deep cleaning/i, r.heard); assert.ok(!/6,000/.test(r.heard), r.heard);
});
