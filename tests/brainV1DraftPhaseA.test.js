'use strict';
// BRAIN_V1_DRAFT_PHASE_A replay of live call HD_4e388c38f7b5 (2026-10-24, voice-qa/2026-10-24_926-dials-two-systems.md).
// Model scripted, no network. Phase A off must leave today's behaviour unchanged.
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const test = require('node:test');
const assert = require('node:assert');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const V1 = require('../src/conversation/v2/v1draft');
const GH = require('../src/conversation/geminiProviderHealth');
const { spoken } = require('../src/conversation/v2/spokenStyle');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId };
const say = (text, refs = [], kind = 'fact') => ({ name: 'say', args: { text, refs, kind } });
const WIN = 'S' + (DD.servicesCatalog.findIndex((s) => /window/i.test(s.name)) + 1);
const GREETING = 'Done and Dusted, this is Shy. Welcome back. How can I help?';
const CALLER = ['I just want to talk quickly.', 'I was looking to make a booking for a window cleaning tomorrow at 2:00 PM. Is it possible?', 'Rongai.', 'Uh, Ongata Rongai in Kanjado.', 'I hope I do. I do think you have my name.', 'Alvin is my name.'];

function harness(phaseA) {
  const scripts = [
    [{ name: 'note_asks', args: { asks: ['other'] } }, say('How can I help you today?', [], 'social')],
    [{ name: 'note_asks', args: { asks: ['book', 'possible'], service_ids: [WIN] } }, { name: 'propose_booking', args: { service_id: WIN } }],
  ];
  let di = 0; const counts = { draft: 0, turnModel: 0 };
  const streamFor = () => async ({ onCall }) => { counts.draft += 1; const sc = scripts[di++] || []; for (const c of sc) { await new Promise((r) => setTimeout(r, 2)); onCall(c); } return { calls: sc }; };
  const turnModel = async () => { counts.turnModel += 1; return { calls: [] }; };
  const env = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V2_MODEL_ID: 'primary', BRAIN_V2_MODEL_BACKUP_ID: 'backup', ...(phaseA ? { BRAIN_V1_DRAFT_PHASE_A: 'on' } : {}) };
  const live = createBrainV2Live({ env, v1DraftStreamFor: streamFor, shadowModel: turnModel, shadowBackupModel: turnModel, prewarm: false, now: () => new Date('2026-10-24T08:52:00Z'), log: () => {}, v1DraftSleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
  return { live, counts };
}
async function replay(phaseA) {
  const { live, counts } = harness(phaseA);
  const out = [];
  for (const [i, t] of CALLER.entries()) {
    const said = [];
    const r = await live.run({ text: t, profile: DD, langLock: 'en', onSentence: (s) => said.push(s.text), heardAgent: i === 0 ? [GREETING] : null });
    out.push({ path: r.path, line: r.streamed ? said.join(' ') : r.line });
  }
  return { out, counts };
}




test('handoffFields maps fact ids to catalogue ids and keeps possible', () => {
  const note = { byId: new Map([['S9', { serviceId: 'svc-win' }]]) };
  const f = V1.handoffFields({ asks: { asks: ['possible', 'other'], service_ids: ['S9'] }, proposals: [{ name: 'propose_booking', args: { service_id: 'S9' } }], note });
  assert.deepStrictEqual(f, { asks: ['possible', 'book'], place: null, service_id: 'svc-win' });
  assert.strictEqual(V1.handoffFields({ asks: { asks: ['other'] }, note }), null);
});

test('spoken style: times and prices', () => {
  assert.strictEqual(spoken('at 14:00 or 09:30', 'en'), 'at 2 PM or 9:30 AM');
  assert.strictEqual(spoken('saa 14:00', 'sw'), 'saa 14:00');
  assert.match(spoken('from KSh 2,200 per m².', 'en'), /shillings per square metre/);
  assert.doesNotMatch(spoken('from KSh 2,200 per m².', 'en'), /KSh|m²/);
});

test('wait / hello-after-wait lines exist in en and sw', () => {
  for (const k of ['wait', 'afterWait', 'goAhead']) for (const l of ['en', 'sw']) assert.ok(V1.phaseALine(k, l));
});

