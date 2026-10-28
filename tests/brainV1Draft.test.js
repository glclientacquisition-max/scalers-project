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
