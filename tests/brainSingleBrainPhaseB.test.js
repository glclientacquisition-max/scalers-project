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
  const added = new Set();
  const applyTools = async (a) => {
    applied.push(a);
    if (a.appointmentAddService) { const k = a.appointmentAddService.idempotencyKey; const dup = added.has(k); added.add(k); return { results: [{ action: 'add_appointment_service', status: dup ? 'duplicate' : 'succeeded', id: a.appointmentAddService.appointmentId }] }; }
    return { results: [{ action: a.appointment ? 'create_appointment' : 'x', ok: true, status: 'ok', id: `row_${applied.length}` }] };
  };
  const live = createBrainV2Live({ env, applyTools, v1DraftStreamFor: streamFor, shadowModel: turnModel, shadowBackupModel: turnModel, prewarm: false, now: () => new Date('2026-10-24T08:52:00Z'), log: () => {}, v1DraftSleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), ...file });
  return { live, counts, requests, applied, writes };
}
async function turn(h, text, langLock = 'en') { const said = []; const r = await h.live.run({ text, profile: DD, langLock, onSentence: (s) => said.push(s.text) }); return { ...r, heard: r.streamed ? said.join(' ') : r.line }; }
const qs = (s) => (String(s).match(/\?/g) || []).length;




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


test('name: a confirmed saved name is used, never asked (name lock in code)', async () => {
  const h = harness({ scripts: () => [say('Sure.')], file: { callerFile: { contactName: 'Alvin', nameConfirmed: true, callerPhone: '+254700000001', openRows: [] } } });
  const T = ['I want to book window cleaning tomorrow at 2 PM.', 'Ongata Rongai.'];
  let last; for (const t of T) last = await turn(h, t);
  assert.doesNotMatch(last.heard, /may i have your name/i); assert.match(last.heard, /Alvin/);
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


test('SW numbers/prices: a Swahili price in words must match the KB; a near-miss is replaced', async () => {
  const carpet = DD.servicesCatalog.findIndex((s) => /carpet/i.test(s.name)) + 1;
  const h = harness({ scripts: () => [say('Usafi wa zulia ni shilingi elfu moja kwa chumba.', [`P${carpet}`], 'fact')] });
  const r = await turn(h, 'Usafi wa zulia ni bei gani?', 'sw');
  assert.doesNotMatch(r.heard, /elfu moja kwa chumba/, `near-miss price must not be spoken: ${r.heard}`);
});


test('SW numbers: "saa nane mchana" is 14:00 in the plan (Swahili clock)', async () => {
  const h = harness({ scripts: () => [say('Sawa.')] });
  await turn(h, 'Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'sw');
  assert.equal(h.live.getState().slots.when.time, '14:00');
});





test('add_service declined: nothing written', async () => {
  const h = harness({ scripts: () => [say('Okay.')] });
  for (const t of ['I want to book window cleaning tomorrow at 2 PM.', 'Ongata Rongai.', 'Alvin.', 'Yes.', 'Also add carpet cleaning.']) await turn(h, t);
  await turn(h, 'No.');
  assert.equal(h.applied.filter((a) => a.appointmentAddService).length, 0);
});

test('booking line items (db helpers): label + per-item keys, de-duplicated', () => {
  const Module = require('module'); const orig = Module._load;
  Module._load = function (req, ...a) { if (req === '@supabase/supabase-js') return { createClient: () => ({}) }; return orig.call(this, req, ...a); };
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://stub'; process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';
  let db; try { db = require('../src/db'); } finally { Module._load = orig; }
  const items = db.appointmentServiceItems(['Interior Window Cleaning', 'Carpet Cleaning (per room)', 'interior window cleaning'], null, 'k1');
  assert.deepEqual(items.map((x) => x.name), ['Interior Window Cleaning', 'Carpet Cleaning (per room)']);
  assert.equal(items[1].key, 'k1#carpet cleaning (per room)');
  assert.equal(db.appointmentServiceLabel(items), 'Interior Window Cleaning + Carpet Cleaning (per room)');
});

test('tool: add_appointment_service validates, writes once, duplicate on repeat', async () => {
  const TE = require('../src/conversation/toolExecution');
  const keys = new Set(); const calls = [];
  const handlers = { addAppointmentService: async (v) => { calls.push(v); const dup = keys.has(v.idempotencyKey); keys.add(v.idempotencyKey); return { id: v.appointmentId, ok: true, duplicate: dup }; } };
  const run = (x) => TE.executeBrainTools({ parsed: { appointmentAddService: x }, capabilities: { createAppointment: true }, handlers });
  const bad = await run({ serviceName: 'Carpet' });
  assert.equal(bad.results[0].status, 'invalid');
  const one = await run({ appointmentId: 'a1', serviceName: 'Carpet', idempotencyKey: 'a1#+carpet' });
  assert.equal(one.results[0].status, 'succeeded', JSON.stringify(one.results));
  const two = await run({ appointmentId: 'a1', serviceName: 'Carpet', idempotencyKey: 'a1#+carpet' });
  assert.equal(two.results[0].status, 'duplicate', JSON.stringify(two.results));
  const off = await TE.executeBrainTools({ parsed: { appointmentAddService: { appointmentId: 'a1', serviceName: 'Sofa' } }, capabilities: { messageOnly: true }, handlers });
  assert.equal(off.results[0].status, 'disabled');
});
