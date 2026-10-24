'use strict';
// Phase B call fixes: replay of staging call HD_b4afd63a69c3 (24 Oct 2026 13:08 EAT, tip 3373d591)
// RCA: voice-qa/2026-10-24_flow-and-call.md. Model scripted with the sentences the real model said.
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const test = require('node:test');
const assert = require('node:assert');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId };
const say = (text, refs = [], kind = 'social') => ({ name: 'say', args: { text, refs, kind } });
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_V1_DRAFT_PHASE_B: 'on', BRAIN_V2_MODEL_ID: 'primary', BRAIN_V2_MODEL_BACKUP_ID: 'backup' };

function harness({ script, profile = DD, delays = {}, file = { callerFile: { contactName: 'Alvin', nameConfirmed: false, callerPhone: '+254700000001', openRows: [] } } } = {}) {
  const applied = []; const requests = [];
  const streamFor = () => async ({ request, onCall, signal }) => {
    requests.push(request);
    const user = request.contents[request.contents.length - 1].parts[0].text;
    const caller = user.split('CALLER: ').pop();
    const sc = script(caller, user);
    if (delays.draftMs) await new Promise((r) => setTimeout(r, delays.draftMs()));
    if (sc === 'fail') throw Object.assign(new Error('t'), { code: 'TIMEOUT' });
    for (const c of sc) { if (signal && signal.aborted) throw new Error('abort'); onCall(c); }
    return { calls: sc };
  };
  const turnModel = async () => { if (delays.understandMs) await new Promise((r) => setTimeout(r, delays.understandMs())); return { calls: [] }; };
  const applyTools = async (a) => { applied.push(a); return { results: [{ action: a.appointment ? 'create_appointment' : 'x', ok: true, status: 'ok', id: `row_${applied.length}` }] }; };
  const live = createBrainV2Live({ onModelStage: (t) => { if (process.env.DBG && t.verdicts) console.log('STAGE', t.phaseB && t.phaseB.step, JSON.stringify(t.verdicts.map((v) => [v.text, v.verdict, v.reasons]))); }, env: ENV, applyTools, v1DraftStreamFor: streamFor, shadowModel: turnModel, shadowBackupModel: turnModel, prewarm: false, now: () => new Date('2026-10-24T10:08:05Z'), log: () => {}, v1DraftSleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), ...file });
  return { live, applied, requests, profile };
}
async function turn(h, text, langLock = 'en') { const said = []; const t0 = Date.now(); let first = null; const r = await h.live.run({ text, profile: h.profile, langLock, onSentence: (s) => { if (first == null) first = Date.now() - t0; said.push(s.text); } }); return { ...r, heard: r.streamed ? said.join(' ') : r.line, firstMs: first == null ? Date.now() - t0 : first }; }
const qs = (s) => (String(s).match(/\?/g) || []).length;
const UNKNOWN = /don'?t have that detail|sina taarifa/i;

// what the real model said on each turn (voice_turn_traces), keyed by caller words
function realModel(caller) {
  if (/how are you/i.test(caller)) return [{ name: 'note_asks', args: { asks: ['book'] } }, say('I am doing well, thank you.')];
  if (/^2:00 PM/i.test(caller)) return 'fail';
  if (/do you do Kileleshwa/i.test(caller)) return [say('Kileleshwa is in Nairobi, so we cover your area.', ['A1'], 'fact')];
  if (/coverage/i.test(caller)) return [say('We cover Nairobi, Kitengela, Kiambu, Juja, Ongata Rongai, and Syokimau.', ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], 'fact'), say('Which place are you in?', [], 'question')];
  if (/^Kileleshwa/i.test(caller)) return [say('Kileleshwa is in Nairobi, so we cover your area.', ['A1'], 'fact')];
  if (/under Alvin/i.test(caller)) return 'fail';
  if (/Yeah, I do so/i.test(caller)) return [say('Interior Window Cleaning on Tuesday 27 October at 2 PM in Kileleshwa, for Alvin.', [], 'fact'), say('Shall I book it?', [], 'question')];
  return [say('Okay.')];
}

test('REPLAY HD_b4afd63a69c3 (13:08 EAT): the call BOOKS, no "I don\'t have that detail", one ask per turn', async () => {
  const h = harness({ script: realModel });
  const T = ['how are you? I was booking window cleaning Tuesday morning, and.', '2:00 PM.', 'do you do Kileleshwa?', "Where's your coverage?", 'Kileleshwa.', 'you can put it under Alvin.', 'Yeah, I do so.'];
  const log = [];
  for (const t of T) { const r = await turn(h, t); log.push(`${t} => [${r.path}] ${r.heard}`); if (process.env.DBG) { const st = h.live.getState(); console.log('ST', t, '=>', r.heard, '|', st.phase, st.expecting, JSON.stringify(st.slots && { n: st.slots.name, c: st.slots.nameConfirmed, p: st.slots.place, w: st.slots.when })); } assert.ok(!UNKNOWN.test(r.heard), `honest-unknown on a known fact: ${t} => ${r.heard}`); assert.ok(qs(r.heard) <= 1, `one ask: ${r.heard}`); }
  console.log(log.join('\n'));
  const appts = h.applied.filter((a) => a.appointment).map((a) => a.appointment);
  assert.equal(appts.length, 1, `booked:\n${log.join('\n')}`);
  assert.match(appts[0].serviceName, /Window/i);
  assert.match(String(appts[0].addressLandmark || appts[0].address || JSON.stringify(appts[0])), /Kileleshwa/i);
});

const AC = require('../src/conversation/v2/areaCoverage');
const { buildFactNote } = require('../src/conversation/v2/v1draftFacts');
const { verifySentence } = require('../src/conversation/v2/v1draftVerify');
const U = require('../src/conversation/unfinishedTurn');
const CP = require('../src/conversation/v2/callPlan');
const WITH_EXCLUDE = { ...DD, serviceAreas: { ...DD.serviceAreas, areas: [...DD.serviceAreas.areas, { id: 'place:kibera', rule: 'exclude' }] } };

test('replay end state: the last reply says it is booked and never asks "shall I book" again', async () => {
  const h = harness({ script: realModel });
  let last;
  for (const t of ['how are you? I was booking window cleaning Tuesday morning, and.', '2:00 PM.', 'do you do Kileleshwa?', "Where's your coverage?", 'Kileleshwa.', 'you can put it under Alvin.', 'Yeah, I do so.']) last = await turn(h, t);
  assert.match(last.heard, /booked/i); assert.doesNotMatch(last.heard, /shall i book/i); assert.ok(qs(last.heard) <= 1, last.heard);
});

test('area: Kileleshwa -> covered through county:nairobi (shared Kenya tree), on every STT spelling', () => {
  for (const t of ['do you do Kileleshwa?', 'Kileleshwa.', 'Kilelesha', 'in Kileleshua', 'we are at kileleswa', 'Niko Kileleshwani']) {
    const r = AC.resolve(t, DD); assert.equal(r && r.status, 'covered', `${t}: ${JSON.stringify(r)}`); assert.equal(r.name, 'Kileleshwa'); assert.equal(r.via, 'county:nairobi');
  }
  assert.equal(AC.resolve('Ongata Rongai.', DD).status, 'covered');
  assert.equal(AC.resolve('Niko Rongai', DD).name, 'Ongata Rongai');
  assert.equal(AC.resolve('Ruiru', DD).via, 'county:kiambu');
});
test('area: landmark -> its place (Sarit -> Westlands, covered)', () => {
  const r = AC.resolve('I stay near Sarit', DD); assert.equal(r.status, 'covered'); assert.equal(r.name, 'Westlands'); assert.equal(r.landmark, 'sarit');
});
test('area: owner exclude beats the county include; outside list; unknown never "I don\'t have that detail"', () => {
  const ex = AC.resolve('I am in Kibera', WITH_EXCLUDE); assert.equal(ex.status, 'excluded'); assert.equal(AC.line(ex, 'en'), "Sorry, we don't cover Kibera.");
  assert.equal(AC.resolve('I am in Kibera', DD).status, 'covered', 'without the exclude row Kibera is in Nairobi');
  const out = AC.resolve('Mnafika Kisumu?', DD); assert.equal(out.status, 'outside'); assert.equal(AC.line(out, 'sw'), 'Samahani, hatufiki Kisumu.');
  const unk = AC.resolve('Do you cover Kwa Mzee?', DD); assert.equal(unk.status, 'unknown'); assert.equal(AC.line(unk, 'en'), 'Which area is that near?');
  for (const t of ["Where's your coverage?", 'you can put it under Alvin.', 'Yeah, I do so.', '2:00 PM.', 'how are you? I was booking window cleaning Tuesday morning, and.']) assert.equal(AC.resolve(t, DD), null, t);
});
test('SW area: "Mnafika Kileleshwa?" -> Ndio, tunafika Kileleshwa; "Niko Kibera" excluded -> Samahani, hatufiki Kibera', () => {
  assert.equal(AC.line(AC.resolve('Mnafika Kileleshwa?', DD), 'sw'), 'Ndio, tunafika Kileleshwa.');
  assert.equal(AC.line(AC.resolve('Niko Kibera', WITH_EXCLUDE), 'sw'), 'Samahani, hatufiki Kibera.');
  assert.equal(AC.resolve('Nipo Syokimau', DD).status, 'covered');
});

test('fact check trusts call state: the read-back of what the caller gave passes; a made-up place still does not', () => {
  const state = { slots: { service: 'Interior Window Cleaning', when: { date: '2026-10-27', time: '14:00' }, place: 'Kileleshwa', name: 'Alvin', nameConfirmed: true } };
  const note = buildFactNote(DD, state, { callerText: 'Yeah, I do so.' });
  for (const s of ['Interior Window Cleaning on Tuesday 27 October at 2 PM in Kileleshwa, for Alvin.', 'Kileleshwa is in Nairobi, so we cover your area.']) {
    const v = verifySentence({ text: s, refs: [], kind: 'fact' }, buildFactNote(DD, state, { callerText: 'Kileleshwa' }), { profile: DD, replyLang: 'en' });
    assert.equal(v.verdict, 'pass', `${s}: ${v.reasons}`);
  }
  assert.equal(verifySentence({ text: 'We also cover Mombasa.', refs: [], kind: 'fact' }, note, { profile: DD, replyLang: 'en' }).verdict, 'replace');
  assert.equal(verifySentence({ text: 'It costs 5000 shillings.', refs: [], kind: 'fact' }, note, { profile: DD, replyLang: 'en' }).verdict, 'replace');
  assert.equal(verifySentence({ text: 'Booked for 3 PM.', refs: [], kind: 'fact' }, note, { profile: DD, replyLang: 'en' }).verdict, 'replace', '3 PM is not the caller\'s time and nothing is written');
});

test('replacement under the plan: one coherent reply, one ask, no "I don\'t know" + step question', async () => {
  const h = harness({ script: (c) => (/eco/i.test(c) ? [say('Yes, we use eco-friendly organic detergents only.', [], 'fact')] : [say('Sure.')]) });
  await turn(h, 'I want to book window cleaning tomorrow at 2 PM.');
  const r = await turn(h, 'Do you use eco products?');
  assert.equal(qs(r.heard), 1, r.heard);
  assert.ok(!(UNKNOWN.test(r.heard) && /where|name|shall i put/i.test(r.heard)), `no unknown + plan question: ${r.heard}`);
});

test('yes at the read-back books: "Yeah, I do so." (EN) and "Ndio, sawa." (SW); "Yes but make it 3" does not', async () => {
  for (const [lang, steps, yes, book] of [
    ['en', ['I want to book window cleaning tomorrow at 2 PM.', 'Kileleshwa.', 'Alvin.'], 'Yeah, I do so.', 1],
    ['sw', ['Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'Kileleshwa.', 'Alvin.'], 'Ndio, sawa.', 1],
    ['sw', ['Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'Kileleshwa.', 'Alvin.'], 'Sawa.', 1],
    ['en', ['I want to book window cleaning tomorrow at 2 PM.', 'Kileleshwa.', 'Alvin.'], 'Yes but make it 3 PM.', 0],
  ]) {
    const h = harness({ script: () => [say(lang === 'sw' ? 'Sawa.' : 'Okay.')], file: {} });
    for (const t of steps) await turn(h, t, lang);
    assert.equal(h.live.getState().phase, 'readback', `${lang} reached read-back`);
    await turn(h, yes, lang);
    assert.equal(h.applied.filter((a) => a.appointment).length, book, `${yes}`);
  }
  assert.ok(CP.isYes('Yeah, I do so.')); assert.ok(CP.isYes('Ndio, sawa.')); assert.ok(!CP.isYes('Yes but make it 3 PM.')); assert.ok(!CP.isYes('Ndio lakini kesho.'));
});

test('turn end: a short yes to our question is whole ("Yeah, I do so."), a real joiner still holds', () => {
  assert.equal(U.unfinishedTurnHold(null, { text: 'Yeah, I do so.', agentAwaitingReply: true }), null);
  assert.equal(U.unfinishedTurnHold(null, { text: 'Ndio, sawa sawa', agentAwaitingReply: true }), null);
  assert.ok(U.unfinishedTurnHold(null, { text: 'Yeah, and', agentAwaitingReply: true }));
  assert.ok(U.unfinishedTurnHold(null, { text: 'Tuesday morning, and.', agentAwaitingReply: true }));
});

test('SW flow with Swahili place names: Mnafika Kileleshwa? -> covered, booking reads back Kileleshwa and books on "ndio"', async () => {
  const h = harness({ script: () => [say('Sawa.')], file: {} });
  await turn(h, 'Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'sw');
  const c = await turn(h, 'Mnafika Kileleshwa?', 'sw');
  assert.ok(!UNKNOWN.test(c.heard), c.heard); assert.equal(h.live.getState().slots.place, 'Kileleshwa');
  await turn(h, 'Alvin.', 'sw');
  await turn(h, 'Ndio.', 'sw');
  const a = h.applied.filter((x) => x.appointment).map((x) => x.appointment);
  assert.equal(a.length, 1); assert.match(JSON.stringify(a[0]), /Kileleshwa/);
});

test('SW excluded place in the flow: "Niko Kibera" -> Samahani, hatufiki Kibera + one ask, place not set', async () => {
  const h = harness({ script: () => [say('Sawa.')], profile: WITH_EXCLUDE, file: {} });
  await turn(h, 'Nataka kubook usafi wa madirisha kesho saa nane mchana.', 'sw');
  const r = await turn(h, 'Niko Kibera.', 'sw');
  assert.match(r.heard, /hatufiki Kibera/); assert.equal(qs(r.heard), 1, r.heard); assert.equal(h.live.getState().slots.place, null);
});
test('EN unknown place in the flow: "Do you cover Kwa Mzee?" -> Which area is that near?', async () => {
  const h = harness({ script: () => [say('Okay.')], file: {} });
  await turn(h, 'I want to book window cleaning tomorrow at 2 PM.');
  const r = await turn(h, 'Do you cover Kwa Mzee?');
  assert.match(r.heard, /Which area is that near\?/); assert.ok(!UNKNOWN.test(r.heard)); assert.equal(qs(r.heard), 1, r.heard);
});
