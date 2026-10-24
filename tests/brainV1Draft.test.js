'use strict';
// BRAIN_V1_DRAFT acceptance suite (design ship-briefs/2026-10-24_brain_v1-draft-kb-verify-design.md §7).
// The model is scripted (no network): each case scripts exactly what the model streams, including
// adversarial invented facts. Pass bar: zero invented facts ever reach onSentence (= TTS).
process.env.BRAIN_V2_FACT_STORE = 'on'; process.env.BRAIN_V2_NLU_GAPS = 'on'; process.env.VOICE_V2_CATALOGUE = 'on';
process.env.BRAIN_V2_CONV_STATE = 'on'; process.env.BRAIN_V2_REPLY_OWNER = 'on';
const test = require('node:test');
const assert = require('node:assert');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const V1 = require('../src/conversation/v2/v1draft');
const { verifySentence } = require('../src/conversation/v2/v1draftVerify');
const { buildFactNote } = require('../src/conversation/v2/v1draftFacts');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const DD = { ...DD0, id: DD0.tenantId };
const NOW = new Date('2026-10-24T07:41:00Z');
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V1_DRAFT: 'on', BRAIN_V2_MODEL_ID: 'primary', BRAIN_V2_MODEL_BACKUP_ID: 'backup' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (text, refs = [], kind = 'fact') => ({ name: 'say', args: { text, refs, kind } });
const asks = (a, extra = {}) => ({ name: 'note_asks', args: { asks: a, ...extra } });
// INVENTED: substrings that must never be spoken
const INVENTED = [/eldoret/i, /2,000/, /4,000/, /1,500/, /free tomorrow/i, /booked you/i, /wiping the glass/i, /nakuru/i, /alvin/i, /nipo/i];

/** script: per call index -> { calls:[...], delays?:[ms], error?:{status|code}, errorAfter?:n } */
function harness(scripts, envExtra = {}) {
  const calls = []; const spoken = []; const stages = [];
  const streamFor = (model) => async ({ signal, onCall }) => {
    const i = calls.length; const sc = (typeof scripts === 'function' ? scripts(i, model) : scripts[i]) || { calls: [] };
    calls.push({ model, i });
    if (sc.error && !sc.errorAfter) { await sleep(sc.delay || 5); const e = new Error('x'); Object.assign(e, sc.error); throw e; }
    let n = 0;
    for (const c of sc.calls) {
      await new Promise((res, rej) => { const t = setTimeout(res, (sc.delays && sc.delays[n]) ?? 5); signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('gemini timeout'); e.code = 'TIMEOUT'; rej(e); }, { once: true }); });
      onCall(c); n += 1;
      if (sc.errorAfter && n >= sc.errorAfter) { const e = new Error('x'); Object.assign(e, sc.error); throw e; }
    }
    return { calls: sc.calls, text: '' };
  };
  const live = createBrainV2Live({ env: { ...ENV, ...envExtra }, v1DraftStreamFor: streamFor, prewarm: false, now: () => NOW, onModelStage: (s) => stages.push(s), log: () => {}, v1DraftSleep: (ms) => sleep(Math.min(ms, 20)) });
  async function turn(text, o = {}) {
    const before = spoken.length;
    const r = await live.run({ text, profile: DD, langLock: o.langLock || null, onSentence: (s) => spoken.push(s.text), shouldAbort: o.shouldAbort });
    const said = r.streamed ? spoken.slice(before).join(' ') : r.line;
    if (!r.streamed) spoken.push(r.line);
    return { ...r, said };
  }
  return { live, turn, calls, spoken, stages };
}
const noInvented = (h) => { for (const s of h.spoken) for (const re of INVENTED) assert.doesNotMatch(s, re, `invented fact spoken: ${s}`); };

test('1 HD_94798 T1: "Nipo." is never used as the name', async () => {
  const h = harness([{ calls: [asks(['other']), say('Hi Nipo, how can I help you today?', [], 'social')] }]);
  const r = await h.turn('Nipo.', { langLock: 'sw' });
  assert.doesNotMatch(r.said, /Nipo/); noInvented(h);
});
test('2 HD_94798 T3: language follows the caller (English after Swahili); a wrong-language draft sentence is dropped', async () => {
  const h = harness([{ calls: [asks(['book']), say('Siku gani ingekufaa wewe kwa usafi huu?', [], 'question'), say('Sure, carpet cleaning is from KSh 2,200 per m².', ['P13'])] }]);
  const r = await h.turn("Yeah, I'd like to know the carpet cleaning price", { langLock: 'sw' });
  assert.equal(r.lang, 'en'); assert.doesNotMatch(r.said, /Siku gani/); assert.match(r.said, /2,200/);
});
test('3 HD_94798 T7: mid-booking "do you offer post-construction and what is done?" is answered from KB; booking service unchanged', async () => {
  const h = harness([{ calls: [asks(['other']), say('How can I help?', [], 'question')] }, { calls: [asks(['explain', 'possible']), say('Yes, we do Post-Construction Clean.', ['S8']), say('It includes dust mitigation, paint and sticker removal, high-pile vacuum and site sanitation.', ['S8']), say('What time on Sunday works for the Carpet Cleaning?', ['S13'], 'question')] }]);
  await h.turn('Hi');
  const st = h.live.getState(); st.intent = 'book'; st.slots.service = 'Carpet Cleaning (per room)'; st.expecting = 'time';
  const r = await h.turn('Do you offer Post-Construction Services and what is done about it?');
  assert.equal(r.path, 'v1_draft'); assert.match(r.said, /dust mitigation/); assert.match(r.said, /What time on Sunday/);
  assert.equal(st.slots.service, 'Carpet Cleaning (per room)');
});
test('4 HD_94798 T12: "Carpet cleaning, right?" is confirmed and the open question asked once', async () => {
  const h = harness([{ calls: [asks(['check_or_correct_detail']), say('Yes, Carpet Cleaning.', ['S13']), say('What time on Sunday?', [], 'question')] }]);
  const r = await h.turn('Carpet cleaning, right?');
  assert.equal(r.said, 'Yes, Carpet Cleaning. What time on Sunday?');
});
test('5 HD_94798 T15: "Ongata Rongai… is it possible?" answered from coverage; the wrong Rongai is never spoken', async () => {
  const h = harness([{ calls: [asks(['possible', 'place']), say('Yes, we cover Ongata Rongai.', ['A5']), say('We cover Rongai in Nakuru too.', ['A5'])] }]);
  const r = await h.turn('Yeah, Ongata Rongai in Kajiado. Is that— is it possible?');
  assert.match(r.said, /we cover Ongata Rongai/); assert.doesNotMatch(r.said, /Nakuru/); noInvented(h);
});
test('6 HD_94798 T18: "what have you said my name is?" — an unconfirmed name is never invented', async () => {
  const h = harness([{ calls: [asks(['check_or_correct_detail']), say('Your name is Alvin.', [], 'fact')] }]);
  const r = await h.turn('What have you said my name is?');
  assert.doesNotMatch(r.said, /Alvin/); assert.match(r.said, /don't have that detail/i);
});
test('7 HD_babe6cdffdc7 T5: explain with no description -> no invented steps, honest unknown + one callback offer', async () => {
  const h = harness([{ calls: [asks(['explain']), say('Interior Window Cleaning involves wiping the glass and frames.', ['S14'])] }]);
  const r = await h.turn('Window cleaning is done, so how?');
  assert.match(r.said, /call you back/); assert.doesNotMatch(r.said, /wiping/);
  assert.equal(h.live.getState().offer, 'callback'); assert.equal(h.live.getState().conv.callback.status, 'offered');
});
test('8 HD_babe T6: "how much is it?" gets the KB price of the current service', async () => {
  const h = harness([{ calls: [asks(['price']), say('Interior Window Cleaning is KSh 200.', ['P14'])] }]);
  const r = await h.turn('And by any chance, how much is it?');
  assert.equal(r.said, 'Interior Window Cleaning is KSh 200.');
});
test('9 HD_babe T8: coverage answered from the listed areas', async () => {
  const h = harness([{ calls: [asks(['coverage']), say('We cover Nairobi, Kitengela, Kiambu, Juja, Ongata Rongai and Syokimau.', ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])] }]);
  const r = await h.turn("Oh, and, uh, what's your coverage?");
  assert.match(r.said, /^We cover Nairobi/);
});
test('10 HD_babe T11: "Definitely no." to an open offer is owned by v2 (no model call)', async () => {
  const h = harness([{ calls: [asks(['explain']), say('Interior Window Cleaning involves wiping.', ['S14'])] }]);
  await h.turn('How is window cleaning done?');
  const n = h.calls.length;
  const r = await h.turn('Definitely no.');
  assert.equal(r.path, 'v2_owned:offer_answer'); assert.equal(h.calls.length, n); assert.ok(r.line.length > 0);
  assert.doesNotMatch(r.line, /didn't catch/i);
});
test('11 HD_87f73ce7003b: Kisumu -> out of area said + explain-unknown + exactly one callback offer', async () => {
  const h = harness([{ calls: [asks(['place', 'explain', 'possible']), say("Unfortunately we don't cover Kisumu.", ['AX1']), say('Interior Window Cleaning is done with a squeegee and vinegar.', ['S14']), say('We also do window frames.', ['S14'])] }]);
  const r = await h.turn("I'm in Kisumu, I wanted window cleaning, how do you do it exactly, is it possible?");
  assert.match(r.said, /don't cover Kisumu/); assert.equal((r.said.match(/call you back/g) || []).length, 1);
  assert.doesNotMatch(r.said, /squeegee|frames/);
});
test('12 HD_a17139a56f0b: price challenge restated from KB; an inflated 4,000 is never spoken', async () => {
  const h = harness([{ calls: [asks(['price']), say('Yes, Post-Construction Clean is KSh 40.', ['P8'])] }, { calls: [asks(['price']), say('Sorry, it is actually KSh 4,000.', ['P8'])] }]);
  const a = await h.turn('Is it really 40?'); assert.match(a.said, /KSh 40\./);
  const b = await h.turn('Is it really 40?'); assert.doesNotMatch(b.said, /4,000/); noInvented(h);
});
test('13 adversarial: unlisted area (Eldoret) claimed as covered is replaced', async () => {
  const h = harness([{ calls: [asks(['place']), say('Yes, we cover Eldoret.', ['A1'])] }]);
  const r = await h.turn('Do you cover Eldoret?');
  assert.doesNotMatch(r.said, /Eldoret/); assert.match(r.said, /don't have that detail/); noInvented(h);
});
test('14 adversarial: unknown price (unlisted service, and a service with an unconfirmed price) is never spoken', async () => {
  const h = harness([{ calls: [asks(['price']), say('Gutter cleaning is KSh 1,500.', [])] }]);
  const r = await h.turn('How much is gutter cleaning?');
  assert.doesNotMatch(r.said, /1,500/);
  const prof = { ...DD, servicesCatalog: DD.servicesCatalog.map((s) => (s.name.startsWith('Sofa') ? { ...s, pricing: { ...s.pricing, confirmed: false } } : s)) };
  const note = buildFactNote(prof, { slots: {} });
  assert.equal(verifySentence({ text: 'Sofa Cleaning is KSh 800 per seat.', refs: ['S12', 'P12'] }, note, { profile: prof }).verdict, 'replace');
});
test('15 adversarial: fake availability is replaced (availability only via the booking flow)', async () => {
  const h = harness([{ calls: [asks(['book']), say("Yes, we're free tomorrow at 9 AM.", ['H1'], 'fact')] }]);
  const r = await h.turn('Are you free tomorrow at 9?');
  assert.doesNotMatch(r.said, /free tomorrow/); noInvented(h);
});
test('16 adversarial: "I\'ve booked you" without a backend write is replaced; propose_booking hands the turn to v2', async () => {
  const h = harness([{ calls: [asks(['other']), say("Great, I've booked you for Sunday.", [], 'fact')] }, { calls: [asks(['book']), { name: 'propose_booking', args: { service_id: 'svc_4dc611dcf0e74b71' } }, say('Booked!', [])] }]);
  const a = await h.turn('Okay so what next then?');
  assert.doesNotMatch(a.said, /booked you/);
  const b = await h.turn('I want to book carpet cleaning, can you do it?');
  assert.equal(b.path, 'v2_action'); assert.doesNotMatch(b.line, /Booked!/);
});
test('17 adversarial: near-miss price (2,000 vs KB 2,200) and inexact area are replaced', async () => {
  const note = buildFactNote(DD, { slots: {} });
  assert.equal(verifySentence({ text: 'Carpet Cleaning is KSh 2,000 per square metre.', refs: ['P13'] }, note, { profile: DD }).verdict, 'replace');
  assert.equal(verifySentence({ text: 'Carpet Cleaning is from KSh 2,200 per m².', refs: ['P13'] }, note, { profile: DD }).verdict, 'pass');
  assert.equal(verifySentence({ text: 'Yes, we cover Rongai.', refs: ['A5'] }, note, { profile: DD }).verdict, 'replace');
  assert.equal(verifySentence({ text: 'Sofa Cleaning is KSh 200 per seat.', refs: ['P14'] }, note, { profile: DD }).verdict, 'replace');
  assert.equal(verifySentence({ text: 'We are open every day from 8 AM to 6 PM.', refs: ['H1'] }, note, { profile: DD }).verdict, 'pass');
  assert.equal(verifySentence({ text: 'We are open every day from 7 AM to 9 PM.', refs: ['H1'] }, note, { profile: DD }).verdict, 'replace');
  assert.equal(verifySentence({ text: 'You can pay by M-Pesa Paybill 542542.', refs: ['M1'] }, note, { profile: DD }).verdict, 'pass');
  assert.equal(verifySentence({ text: 'You can pay by M-Pesa Paybill 542543.', refs: ['M1'] }, note, { profile: DD }).verdict, 'replace');
});
test('18 ladder: timeout -> retry primary; 503 twice -> backup; all fail -> v2 total fallback; mid-stream break -> no restart', async () => {
  const dl = { r1FirstMs: 60, r2FirstByMs: 400, r3FirstByMs: 600, wallMs: 1000, fillerMs: 900 };
  const ok = { calls: [asks(['price']), say('Interior Window Cleaning is KSh 200.', ['P14'])] };
  let h = harness([{ calls: [say('late', [])], delays: [300] }, ok]); h.live = h.live; // R1 times out
  let live = createBrainV2Live({ env: ENV, v1DraftStreamFor: null });
  void live;
  const run = async (scripts) => { const calls = []; const stages = []; const spoken = [];
    const sf = (model) => async ({ signal, onCall }) => { const sc = scripts[calls.length] || { error: { code: 'TIMEOUT' } }; calls.push(model);
      if (sc.error && !sc.errorAfter) { const e = new Error('x'); Object.assign(e, sc.error); throw e; }
      let n = 0; for (const c of sc.calls) { await new Promise((res, rej) => { const t = setTimeout(res, (sc.delays || [])[n] ?? 5); signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('t'); e.code = 'TIMEOUT'; rej(e); }, { once: true }); }); onCall(c); n += 1; if (sc.errorAfter && n >= sc.errorAfter) { const e = new Error('x'); Object.assign(e, sc.error); throw e; } }
      return {}; };
    const lv = createBrainV2Live({ env: ENV, v1DraftStreamFor: sf, prewarm: false, now: () => NOW, onModelStage: (s) => stages.push(s), log: () => {}, v1DraftDeadlines: dl, v1DraftSleep: () => sleep(5) });
    const r = await lv.run({ text: 'How much is interior window cleaning?', profile: DD, onSentence: (s) => spoken.push(s.text) });
    return { r, calls, stage: stages.find((s) => s.kind === 'v1_draft'), spoken }; };
  let x = await run([{ calls: [say('late', [])], delays: [300] }, ok]);
  assert.deepEqual(x.calls, ['primary', 'primary']); assert.equal(x.r.path, 'v1_draft'); assert.equal(x.stage.used, 'primary'); assert.equal(x.stage.attempts.length, 2);
  x = await run([{ error: { status: 503 } }, { error: { status: 503 } }, ok]);
  assert.deepEqual(x.calls, ['primary', 'primary', 'backup']); assert.equal(x.stage.used, 'backup');
  x = await run([{ error: { code: 'TIMEOUT' } }, { error: { code: 'TIMEOUT' } }]);
  assert.equal(x.r.path, 'v2_fallback'); assert.ok(x.r.line.length > 0); assert.equal(x.calls.length, 2);
  x = await run([{ calls: [asks(['price']), say('Interior Window Cleaning is KSh 200.', ['P14']), say('more', [])], errorAfter: 2, error: { status: 503 } }]);
  assert.equal(x.r.path, 'v1_draft'); assert.equal(x.calls.length, 1); assert.deepEqual(x.spoken, ['Interior Window Cleaning is KSh 200.']);
  void h;
});
test('19 barge-in mid-draft stops the stream: nothing further is spoken', async () => {
  let barged = false;
  const h = harness([{ calls: [asks(['coverage']), say('We cover Nairobi.', ['A1']), say('We also cover Juja.', ['A4'])], delays: [5, 5, 80] }]);
  const p = h.turn('What is your coverage?', { shouldAbort: () => barged });
  setTimeout(() => { barged = true; }, 40);
  const r = await p;
  assert.deepEqual(h.spoken, ['We cover Nairobi.']); assert.equal(r.path, 'v1_draft');
});
test('20 revert: flag off (or another tenant) = v2 unchanged, the drafter is never called', async () => {
  const sc = [{ calls: [say('Should never be spoken.', [])] }];
  for (const extra of [{ BRAIN_V1_DRAFT: 'off' }, { BRAIN_V1_DRAFT_TENANTS: 'some-other-tenant' }]) {
    const h = harness(sc, extra);
    const ref = createBrainV2Live({ env: { BRAIN_V2: '1', BRAIN_V2_MODE: 'live' }, prewarm: false, now: () => NOW, log: () => {} });
    for (const t of ['Hi', 'How much is carpet cleaning?', "What's your coverage?"]) {
      const a = await h.live.run({ text: t, profile: DD }); const b = await ref.run({ text: t, profile: DD });
      assert.equal(a.line, b.line); assert.equal(a.path, undefined);
    }
    assert.equal(h.calls.length, 0);
  }
  assert.equal(V1.mode({ env: { BRAIN_V1_DRAFT: 'on' }, tenantId: DD.id }), 'on');
  assert.equal(V1.mode({ env: { BRAIN_V1_DRAFT: 'shadow' }, tenantId: DD.id }), 'shadow');
  assert.equal(V1.mode({ env: { BRAIN_V1_DRAFT: 'on' }, tenantId: 'aris' }), 'off');
});
test('one call per turn; trace = the call used, with per-sentence verdicts; partial start is reused by the final', async () => {
  const h = harness([{ calls: [asks(['price']), say('Interior Window Cleaning is KSh 200.', ['P14']), say('Gutters are KSh 900.', [])] }]);
  await h.turn('Hi there'); // first turn (script 0 consumed)
  const h2 = harness(() => ({ calls: [asks(['price']), say('Interior Window Cleaning is KSh 200.', ['P14'])] }));
  await h2.turn('Hello');
  h2.live.partial({ text: 'How much is interior window cleaning', profile: DD });
  const r = await h2.turn('How much is interior window cleaning?');
  assert.equal(h2.calls.length, 2); assert.equal(r.path, 'v1_draft');
  const st = h2.stages.filter((s) => s.kind === 'v1_draft').pop();
  assert.equal(st.startedOn, 'partial'); assert.equal(st.used, 'primary'); assert.equal(st.verdicts[0].verdict, 'pass');
  const s1 = h.stages.find((s) => s.kind === 'v1_draft');
  assert.deepEqual(s1.verdicts.map((v) => v.verdict), ['pass', 'replace']); assert.ok(s1.verdicts[1].replacement);
});
test('shadow mode drafts and traces but never speaks or mutates state', async () => {
  const h = harness([{ calls: [asks(['price']), say('Interior Window Cleaning is KSh 200.', ['P14'])] }], { BRAIN_V1_DRAFT: 'shadow' });
  const r = await h.turn('How much is interior window cleaning?');
  assert.equal(r.path, undefined); assert.equal(r.streamed, undefined);
  await sleep(50); assert.equal(h.stages.filter((s) => s.kind === 'v1_draft').length, 1);
  assert.equal(h.live.getState().v1History.length, 2);
});
