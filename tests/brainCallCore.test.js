'use strict';
// BRAIN_CALL_CORE: one call core (events -> reducer -> receipts -> ReplyPlan -> composer/template -> verifier).
// The 14 real-call cases from voice-qa/2026-10-25_root-cause-architecture.md §5, each in EN and SW. Model scripted.
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1' })) process.env[k] = v;
const test = require('node:test');
const assert = require('node:assert');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const CC = require('../src/conversation/v2/callCore');
const OT = require('../src/conversation/v2/ownerTextSetting');
const { unfinishedTurnHold } = require('../src/conversation/unfinishedTurn');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId };
const say = (text, refs = [], kind = 'social') => ({ name: 'say', args: { text, refs, kind } });
const BASE = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_V2_MODEL_ID: 'primary', BRAIN_V2_MODEL_BACKUP_ID: 'backup' };
const ENV = { ...BASE, BRAIN_CALL_CORE: 'on' };
const NOW = '2026-10-24T08:52:00Z';

function harness({ scripts = () => [say('Sure.')], env = ENV, callerFile = { contactName: null, callerPhone: '+254700000001', openRows: [] } } = {}) {
  const applied = []; const stages = [];
  const streamFor = () => async ({ onCall }) => { const sc = typeof scripts === 'function' ? scripts() : scripts; if (sc === 'fail') throw Object.assign(new Error('boom'), { code: 'TIMEOUT' }); for (const c of sc) { await new Promise((r) => setTimeout(r, 1)); onCall(c); } return { calls: sc }; };
  const turnModel = async () => ({ calls: [] });
  const applyTools = async (a) => { applied.push(a); const k = Object.keys(a)[0]; return { results: [{ action: a.appointment ? 'create_appointment' : k, ok: true, status: 'ok', id: `row_${applied.length}` }] }; };
  const live = createBrainV2Live({ env, applyTools, v1DraftStreamFor: streamFor, shadowModel: turnModel, shadowBackupModel: turnModel, prewarm: false, now: () => new Date(NOW), log: () => {}, onModelStage: (s) => stages.push(s), v1DraftSleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), callerFile });
  return { live, applied, stages };
}
async function turn(h, text, langLock = 'en') { const said = []; const r = await h.live.run({ text, profile: DD, langLock, onSentence: (s) => said.push(s.text) }); return { ...r, heard: r.streamed ? said.join(' ') : r.line }; }
const qs = (s) => (String(s).match(/\?/g) || []).length;
const L = {
  en: { book: 'I want to book window cleaning tomorrow at 2 PM.', place: 'Ongata Rongai.', name: 'Alvin.', yes: 'Yeah, I do so.', cov: 'Do you do Kileleshwa?', cov2: 'Do you have Kilimani?', pay: 'Do you accept crypto?', cancel: 'I want to cancel my booking.', cancelWhy: 'Cancel it because they never came.', switch: 'No, I want to make a booking for window cleaning.', callMe: 'Can you have someone call me back?', yes2: 'Yes.', full: 'Alvin Yegon.', add: 'Can we add carpet cleaning to it?' },
  sw: { book: 'Nataka kubook usafi wa madirisha kesho saa nane mchana.', place: 'Ongata Rongai.', name: 'Alvin.', yes: 'Ndio, sawa.', cov: 'Mnafika Kileleshwa?', cov2: 'Mnafika Kilimani?', pay: 'Mnakubali crypto?', cancel: 'Nataka ku cancel booking yangu.', cancelWhy: 'Ni ya kitambo kidogo, cancel kwa sababu hawakuja.', switch: 'Hapana, nataka kubook usafi wa madirisha.', callMe: 'Mnaweza kunipigia simu baadaye?', yes2: 'Ndio.', full: 'Alvin Yegon.', add: 'Ongeza pia usafi wa zulia.' },
};


for (const lang of ['en', 'sw']) {
  const T = L[lang];
  test(`[${lang}] 5 fragments: ONE end-of-turn decision (Voice gate), the core adds no second hold`, () => {
    const frag = lang === 'sw' ? 'Nilikuwa nauliza,' : 'I was wondering if,';
    assert.ok(unfinishedTurnHold(null, { text: frag }), 'Voice holds the fragment');
    assert.equal(unfinishedTurnHold(null, { text: frag, holdTimedOut: true }), null, 'released once, never held twice');
  });
  test(`[${lang}] 6 no "noted / they'll call you" without a receipt`, async () => {
    const h = harness({ scripts: () => [say(lang === 'sw' ? 'Nimeandika, watakupigia.' : "I've noted that, the team will call you."), say(lang === 'sw' ? 'Sawa.' : 'Okay.')] });
    const r = await turn(h, T.cancelWhy, lang);
    assert.doesNotMatch(r.heard, /noted|will call you|nimeandika|watakupigia/i, r.heard);
  });
  test(`[${lang}] 8 a list names only upcoming open bookings, at most 3; past rows never offered`, async () => {
    const past = [1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, job: 'Sofa Cleaning (per seat)', window_start: `2026-10-0${i}T07:00:00Z`, status: 'requested' }));
    const fut = [26, 27, 28, 29].map((d, i) => ({ id: `f${i}`, job: i % 2 ? 'Carpet Cleaning (per room)' : 'Mattress cleaning', window_start: `2026-10-${d}T07:00:00Z`, status: 'requested' }));
    const h = harness({ scripts: () => [say(lang === 'sw' ? 'Sawa.' : 'Okay.')], callerFile: { contactName: 'Alvin', nameConfirmed: true, callerPhone: '+254700000001', openRows: [...past, ...fut] } });
    const r = await turn(h, T.cancel, lang);
    assert.ok(qs(r.heard) <= 1, r.heard);
    assert.doesNotMatch(r.heard, /\b(1st|2nd|3rd|4th|5th)\b|tarehe [1-5]\b/i, r.heard);
    const listed = (r.heard.match(/\b(or|au)\b/g) || []).length; assert.ok(listed <= 2, `max 3 rows: ${r.heard}`);
    assert.equal(h.applied.filter((a) => a.cancelAppointment || a.cancel_booking).length, 0, 'never closes old rows');
  });
}


test('verifier: the composer writes no state (offer/service) under the core', async () => {
  const h = harness({ scripts: () => [say('We have a special on sofas, want a callback?', [], 'question')] });
  await turn(h, L.en.book);
  assert.notEqual(h.live.getState().offer, 'callback');
});

test('owner text setting: default ON; off skips the text (B2: the core is always on, no env gate)', () => {
  assert.equal(OT.ownerTextOn({}), true);
  assert.equal(OT.ownerTextOn({ businessPolicies: { owner_text_callback_cancel: false } }), false);
  const off = { id: DD.id, businessPolicies: { owner_text_callback_cancel: false } };
  assert.equal(OT.skipOwnerText({ env: ENV, profile: off, kind: 'callback' }), true);
  assert.equal(OT.skipOwnerText({ env: ENV, profile: off, kind: 'cancel' }), true);
  assert.equal(OT.skipOwnerText({ env: BASE, profile: off, kind: 'callback' }), true, 'B2: no BRAIN_CALL_CORE gate, the owner setting always holds');
  assert.equal(OT.skipOwnerText({ env: ENV, profile: { id: DD.id }, kind: 'callback' }), false, 'default on');
  assert.equal(OT.skipOwnerText({ env: ENV, profile: off, kind: 'booking' }), false);
});
