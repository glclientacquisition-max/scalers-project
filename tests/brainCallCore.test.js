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

test('flag: off by default, DnD only; flag off = Phase B code path (core never runs)', async () => {
  assert.equal(CC.coreOn({ env: BASE, tenantId: DD.id }), false);
  assert.equal(CC.coreOn({ env: ENV, tenantId: 'other' }), false);
  assert.equal(CC.coreOn({ env: ENV, tenantId: DD.id }), true);
  const h = harness({ env: { ...BASE, BRAIN_V1_DRAFT_PHASE_B: 'on' } });
  const r = await turn(h, L.en.book);
  assert.equal(r.core, undefined); assert.equal(h.stages.filter((s) => s.kind === 'call_core').length, 0);
});

for (const lang of ['en', 'sw']) {
  const T = L[lang];
  test(`[${lang}] 1+9 coverage question answered first (areaPicks resolver), then one step question; also on model timeout`, async () => {
    for (const scripts of [() => [say(lang === 'sw' ? 'Sawa.' : 'Sure.')], 'fail']) {
      const h = harness({ scripts });
      await turn(h, T.book, lang);
      const r = await turn(h, T.cov, lang);
      assert.match(r.heard, /Kileleshwa/, r.heard); assert.ok(qs(r.heard) <= 1, r.heard);
      assert.doesNotMatch(r.heard, /don'?t have that|sina maelezo/i);
      const r2 = await turn(h, T.cov2, lang);
      assert.match(r2.heard, /Kilimani/, r2.heard); assert.ok(qs(r2.heard) <= 1, r2.heard);
    }
  });
  test(`[${lang}] 2+3 yes at the read-back books ONE row in one turn; the read-back is built from state`, async () => {
    const h = harness({ scripts: () => [say(lang === 'sw' ? 'Sawa.' : 'Sure.')] });
    for (const t of [T.book, T.place, T.name]) await turn(h, t, lang);
    const st = h.live.getState(); assert.equal(st.phase, 'readback');
    assert.match(st.lastLine, /Rongai/);
    const y = await turn(h, T.yes, lang);
    assert.equal(h.applied.filter((a) => a.appointment).length, 1); assert.ok(y.heard.length > 0);
  });
  test(`[${lang}] 4 one name step: a yes to the saved name keeps the place/day/time said in the same turn`, async () => {
    const h = harness({ callerFile: { contactName: 'Alvin', nameConfirmed: false, callerPhone: '+254700000001', openRows: [] } });
    await turn(h, lang === 'sw' ? 'Habari.' : 'Hello.', lang);
    const st = h.live.getState(); st.expecting = 'name_confirm'; st.nameConfirmAsked = true;
    const r = await turn(h, lang === 'sw' ? 'Ndio, ni mimi Alvin. Nataka kubook Kileleshwa kesho saa nane mchana.' : "Yeah, it's Alvin. Booking Kileleshwa tomorrow 2 PM.", lang);
    assert.ok(qs(r.heard) <= 1, r.heard); assert.match(r.heard, /Alvin/, `welcome back lead kept: ${r.heard}`);
    assert.equal(st.slots.place, 'Kileleshwa'); assert.ok(st.slots.when.date, 'day kept'); assert.ok(st.slots.when.time, 'time kept');
    assert.ok(st.slots.nameConfirmed || (st.file && st.file.nameConfirmed), 'name confirmed once');
  });
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
  test(`[${lang}] 7 cancel -> booking switch goes to the booking flow, not the cancel list`, async () => {
    const rows = [{ id: 'a1', job: 'Sofa Cleaning (per seat)', window_start: '2026-10-28T07:00:00Z', status: 'requested' }, { id: 'a2', job: 'Carpet Cleaning (per room)', window_start: '2026-10-29T07:00:00Z', status: 'requested' }];
    const h = harness({ callerFile: { contactName: 'Alvin', nameConfirmed: true, callerPhone: '+254700000001', openRows: rows } });
    await turn(h, T.cancel, lang);
    assert.equal(h.live.getState().intent, 'cancel');
    const r = await turn(h, T.switch, lang);
    assert.notEqual(h.live.getState().intent, 'cancel'); assert.doesNotMatch(r.heard, /which one|ipi:/i, r.heard);
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
  test(`[${lang}] 10 payment question gets its answer only (no "I don't have that detail") + step`, async () => {
    const h = harness({ scripts: 'fail' });
    await turn(h, T.book, lang);
    const r = await turn(h, T.pay, lang);
    assert.match(r.heard, /M-Pesa/); assert.doesNotMatch(r.heard, /don'?t have that|sina maelezo/i); assert.ok(qs(r.heard) <= 1, r.heard);
  });
  test(`[${lang}] 11 "call me back" becomes a callback EFFECT with a receipt before any "they'll call you"`, async () => {
    const h = harness({ scripts: () => [say(lang === 'sw' ? 'Watakupigia.' : "They'll call you.")] });
    const r1 = await turn(h, T.callMe, lang);
    assert.doesNotMatch(r1.heard, /they'll call you|watakupigia/i, `no claim before the effect: ${r1.heard}`);
    await turn(h, T.yes2, lang);
    for (let i = 0; i < 2 && !h.applied.some((a) => a.escalate); i++) await turn(h, T.yes2, lang);
    assert.ok(h.applied.some((a) => a.escalate), 'callback task written');
    const rec = h.live.getState().receipts.find((x) => x.tool === 'create_handoff' || x.action === 'escalate'); assert.ok(rec && rec.ok, 'receipt');
  });
  test(`[${lang}] 12 a two-word name is the name, never "And"`, async () => {
    const h = harness();
    for (const t of [T.book, T.place]) await turn(h, t, lang);
    await turn(h, T.full, lang);
    const n = h.live.getState().slots.name; assert.match(String(n), /^Alvin/); assert.notEqual(n, 'And');
  });
  test(`[${lang}] 14 multi-service: add at the read-back -> one read-back, one yes, ONE booking with 2 services`, async () => {
    const h = harness();
    for (const t of [T.book, T.place, T.name]) await turn(h, t, lang);
    const r = await turn(h, T.add, lang);
    assert.match(r.heard, /carpet|zulia/i, r.heard); assert.equal(qs(r.heard), 1, r.heard);
    await turn(h, T.yes2, lang);
    const appts = h.applied.filter((a) => a.appointment).map((a) => a.appointment);
    assert.equal(appts.length, 1); assert.equal((appts[0].services || []).length, 2);
  });
}

test('13 SW code-switch: "kesho saa nane" -> 14:00 tomorrow; trace R0 records events, writes, stage timings, plan', async () => {
  const h = harness();
  await turn(h, L.sw.book, 'sw');
  const st = h.live.getState(); assert.equal(st.slots.when.time, '14:00'); assert.equal(st.slots.when.date, '2026-10-25');
  const c = h.stages.find((s) => s.kind === 'call_core');
  assert.ok(c && Array.isArray(c.events) && Array.isArray(c.writes) && c.writes.length && c.stagesMs && c.plan && c.plan.step);
  assert.ok(typeof c.stagesMs.reduce === 'number' && typeof c.stagesMs.compose === 'number');
});

test('verifier: the composer writes no state (offer/service) under the core', async () => {
  const h = harness({ scripts: () => [say('We have a special on sofas, want a callback?', [], 'question')] });
  await turn(h, L.en.book);
  assert.notEqual(h.live.getState().offer, 'callback');
});

test('owner text setting: default ON; off only skips the text when the core is on', () => {
  assert.equal(OT.ownerTextOn({}), true);
  assert.equal(OT.ownerTextOn({ businessPolicies: { owner_text_callback_cancel: false } }), false);
  const off = { id: DD.id, businessPolicies: { owner_text_callback_cancel: false } };
  assert.equal(OT.skipOwnerText({ env: ENV, profile: off, kind: 'callback' }), true);
  assert.equal(OT.skipOwnerText({ env: ENV, profile: off, kind: 'cancel' }), true);
  assert.equal(OT.skipOwnerText({ env: BASE, profile: off, kind: 'callback' }), false, 'flag off = today');
  assert.equal(OT.skipOwnerText({ env: ENV, profile: { id: DD.id }, kind: 'callback' }), false, 'default on');
  assert.equal(OT.skipOwnerText({ env: ENV, profile: off, kind: 'booking' }), false);
});
