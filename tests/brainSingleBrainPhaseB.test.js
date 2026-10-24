'use strict';
// BRAIN_V1_DRAFT_PHASE_B: one call plan (v2) guides the call, the model speaks every turn.
// Replays HD_4e388c38f7b5 (voice-qa/2026-10-24_926-dials-two-systems.md) + Swahili cases. Model scripted, no network.
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const test = require('node:test');
const assert = require('node:assert');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const CP = require('../src/conversation/v2/callPlan');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId };
const say = (text, refs = [], kind = 'social') => ({ name: 'say', args: { text, refs, kind } });
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_V1_DRAFT_PHASE_B: 'on', BRAIN_V2_MODEL_ID: 'primary', BRAIN_V2_MODEL_BACKUP_ID: 'backup' };

function harness({ scripts = [], env = ENV, file = {}, writes } = {}) {
  let di = 0; const counts = { draft: 0, turnModel: 0 }; const requests = [];
  const streamFor = () => async ({ request, onCall }) => { counts.draft += 1; requests.push(request); const sc = typeof scripts === 'function' ? scripts(request) : scripts[di++] || []; if (sc === 'fail') throw Object.assign(new Error('boom'), { code: 'TIMEOUT' }); for (const c of sc) { await new Promise((r) => setTimeout(r, 1)); onCall(c); } return { calls: sc }; };
  const turnModel = async () => { counts.turnModel += 1; return { calls: [] }; };
  const applied = [];
  const applyTools = async (a) => { applied.push(a); return { results: [{ action: a.appointment ? 'create_appointment' : 'x', ok: true, status: 'ok', id: `row_${applied.length}` }] }; };
  const live = createBrainV2Live({ env, applyTools, v1DraftStreamFor: streamFor, shadowModel: turnModel, shadowBackupModel: turnModel, prewarm: false, now: () => new Date('2026-10-24T08:52:00Z'), log: () => {}, v1DraftSleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), ...file });
  return { live, counts, requests, applied, writes };
}
async function turn(h, text, langLock = 'en') { const said = []; const r = await h.live.run({ text, profile: DD, langLock, onSentence: (s) => said.push(s.text) }); return { ...r, heard: r.streamed ? said.join(' ') : r.line }; }
const qs = (s) => (String(s).match(/\?/g) || []).length;

test('flag off by default: Phase B never runs without BRAIN_V1_DRAFT_PHASE_B=on', () => {
  assert.equal(CP.phaseB({ env: { ...ENV, BRAIN_V1_DRAFT_PHASE_B: 'off' }, tenantId: DD.id }), false);
  assert.equal(CP.phaseB({ env: ENV, tenantId: 'other-tenant' }), false);
  assert.equal(CP.phaseB({ env: { ...ENV, BRAIN_V1_DRAFT_PHASE_A: 'off' }, tenantId: DD.id }), false);
  assert.equal(CP.phaseB({ env: ENV, tenantId: DD.id }), true);
});

test('HD_4e388 replay: the model speaks EVERY turn (no owner switch), one question per turn', async () => {
  const h = harness({ scripts: () => [{ name: 'note_asks', args: { asks: ['other'] } }, say('Alright.')] });
  const T = ['I was looking to make a booking for a window cleaning tomorrow at 2:00 PM. Is it possible?', 'Ongata Rongai.', 'Alvin.'];
  for (const t of T) { const r = await turn(h, t); assert.equal(r.path, 'v1_draft', `${t} -> ${r.path}`); assert.ok(qs(r.heard) <= 1, r.heard); assert.ok(qs(r.heard) === 1, `the step question is always asked: ${r.heard}`); }
  assert.equal(h.counts.draft, 3); assert.equal(h.counts.turnModel, 3, 'one v2 understanding call per turn, no shadow/classify');
});

test('HD_4e388 T8: "add carpet cleaning" at the read-back APPENDS an item; read-back lists both; yes writes both', async () => {
  const h = harness({ scripts: () => [say('Sure.')] });
  for (const t of ['I want to book window cleaning tomorrow at 2 PM.', 'Ongata Rongai.', 'Alvin.']) await turn(h, t);
  assert.equal(h.live.getState().phase, 'readback');
  const r = await turn(h, 'Can we add, like, carpet cleaning to it?');
  assert.match(r.heard, /window/i); assert.match(r.heard, /carpet/i); assert.equal(qs(r.heard), 1, r.heard);
  assert.deepEqual(h.live.getState().plan.items.map((i) => i.service), ['Interior Window Cleaning', 'Carpet Cleaning (per room)']);
  const y = await turn(h, 'Yes.');
  const svcs = h.applied.filter((a) => a.appointment).map((a) => a.appointment.serviceName);
  assert.deepEqual(svcs, ['Interior Window Cleaning', 'Carpet Cleaning (per room)'], JSON.stringify(svcs));
  assert.ok(y.heard.length > 0);
});

test('switch is still a replace ("carpet instead"), not an add', () => {
  assert.equal(CP.ADD.test('carpet cleaning instead') && !CP.SWITCH.test('carpet cleaning instead'), false);
});

test('read-back in the model\'s words must carry the exact plan, else the plan read-back is spoken', async () => {
  const h = harness({ scripts: () => [say('Shall I book window cleaning in Kisumu?', [], 'question')] });
  for (const t of ['I want to book window cleaning tomorrow at 2 PM.', 'Ongata Rongai.']) await turn(h, t);
  const r = await turn(h, 'Alvin.');
  assert.match(r.heard, /Rongai/); assert.doesNotMatch(r.heard, /Kisumu/); assert.equal(qs(r.heard), 1);
});

test('one question per turn: a second model question is dropped', async () => {
  const h = harness({ scripts: () => [say('Where should we come?', [], 'question'), say('Would you like a deep clean too?', [], 'question')] });
  const r = await turn(h, 'I want to book window cleaning tomorrow at 2 PM.');
  assert.equal(qs(r.heard), 1, r.heard); assert.doesNotMatch(r.heard, /deep clean/);
});

test('off-step question is replaced by the plan question (the plan decides the next step)', async () => {
  const h = harness({ scripts: () => [say('What is your budget?', [], 'question')] });
  const r = await turn(h, 'I want to book window cleaning tomorrow at 2 PM.');
  assert.doesNotMatch(r.heard, /budget/); assert.match(r.heard, /where|place|area/i);
});

test('model failure: the plan template is spoken (total fallback), same step', async () => {
  const h = harness({ scripts: () => 'fail' });
  const r = await turn(h, 'I want to book window cleaning tomorrow at 2 PM.');
  assert.match(String(r.path), /^plan_fallback/); assert.match(r.heard, /\?/);
});

test('name: a confirmed saved name is used, never asked (name lock in code)', async () => {
  const h = harness({ scripts: () => [say('Sure.')], file: { callerFile: { contactName: 'Alvin', nameConfirmed: true, callerPhone: '+254700000001', openRows: [] } } });
  const T = ['I want to book window cleaning tomorrow at 2 PM.', 'Ongata Rongai.'];
  let last; for (const t of T) last = await turn(h, t);
  assert.doesNotMatch(last.heard, /may i have your name/i); assert.match(last.heard, /Alvin/);
});

test('name: "you have my name" with nothing saved is answered honestly, not re-asked blind', async () => {
  const h = harness({ scripts: () => [say('Okay.')] });
  for (const t of ['I want to book window cleaning tomorrow at 2 PM.', 'Ongata Rongai.']) await turn(h, t);
  const r = await turn(h, 'I do think you have my name.');
  assert.doesNotMatch(r.heard, /^Sorry, may I have your name again/); assert.match(r.heard, /name/i); assert.equal(qs(r.heard), 1);
});

test('name: a bare-word turn ("Nipo.") never becomes a spoken name', async () => {
  const h = harness({ scripts: () => [say('Asante Nipo.')] });
  await turn(h, 'Nipo.', 'sw');
  const r = await turn(h, 'Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'sw');
  assert.doesNotMatch(r.heard, /Nipo/);
});

// ---- Swahili ----
test('SW places: Swahili booking reads back Ongata Rongai and asks one question in Swahili', async () => {
  const h = harness({ scripts: () => [say('Sawa.')] });
  await turn(h, 'Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'sw');
  await turn(h, 'Ongata Rongai.', 'sw');
  const r = await turn(h, 'Alvin.', 'sw');
  assert.match(r.heard, /Rongai/); assert.match(r.heard, /Alvin/); assert.equal(qs(r.heard), 1, r.heard); assert.match(r.heard, /Nithibitishe|ni sawa/i);
});

test('SW add-service: "ongeza usafi wa zulia" appends carpet to the window booking', async () => {
  const h = harness({ scripts: () => [say('Sawa.')] });
  for (const t of ['Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'Ongata Rongai.', 'Alvin.']) await turn(h, t, 'sw');
  const r = await turn(h, 'Ongeza pia usafi wa zulia.', 'sw');
  assert.deepEqual(h.live.getState().plan.items.map((i) => i.service), ['Interior Window Cleaning', 'Carpet Cleaning (per room)']);
  assert.match(r.heard, / na /); assert.equal(qs(r.heard), 1);
});

test('SW numbers/prices: a Swahili price in words must match the KB; a near-miss is replaced', async () => {
  const carpet = DD.servicesCatalog.findIndex((s) => /carpet/i.test(s.name)) + 1;
  const h = harness({ scripts: () => [say('Usafi wa zulia ni shilingi elfu moja kwa chumba.', [`P${carpet}`], 'fact')] });
  const r = await turn(h, 'Usafi wa zulia ni bei gani?', 'sw');
  assert.doesNotMatch(r.heard, /elfu moja kwa chumba/, `near-miss price must not be spoken: ${r.heard}`);
});

test('SW code-switch: caller switches English -> Swahili mid-call; the step and reply follow Swahili', async () => {
  const h = harness({ scripts: (req) => { const sw = /reply_lang: sw/.test(JSON.stringify(req.contents.slice(-1))); return [say(sw ? 'Sawa.' : 'Okay.')]; } });
  await turn(h, 'I want to book window cleaning tomorrow at 2 PM.', null);
  const r = await turn(h, 'Sawa, niko Ongata Rongai, karibu na Tuskys.', null);
  assert.match(r.heard, /^Sawa/); assert.match(String(h.live.getState().slots.place), /Rongai/);
  assert.match(JSON.stringify(h.requests.at(-1).contents.slice(-1)), /reply_lang: sw/);
});

test('SW numbers: "saa nane mchana" is 14:00 in the plan (Swahili clock)', async () => {
  const h = harness({ scripts: () => [say('Sawa.')] });
  await turn(h, 'Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'sw');
  assert.equal(h.live.getState().slots.when.time, '14:00');
});

test('D1 rules-only understanding: BRAIN_V1_DRAFT_PHASE_B_UNDERSTAND=rules makes no understanding call', async () => {
  const h = harness({ env: { ...ENV, BRAIN_V1_DRAFT_PHASE_B_UNDERSTAND: 'rules' }, scripts: () => [say('Okay.')] });
  await turn(h, 'I want to book window cleaning tomorrow at 2 PM.');
  assert.equal(h.counts.turnModel, 0); assert.equal(h.counts.draft, 1);
});
