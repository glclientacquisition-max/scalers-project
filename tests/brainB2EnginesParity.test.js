'use strict';
// B2 (retire the old brain): every caller turn is the engines, through the real live entry (createBrainV2Live ->
// liveTurn.run -> runBrainEnginesTurn). These replace the createBrainV2Live-driven tests of the deleted non-engines
// runners (#932 call core, #933 model lead, Phase B call plan, C7 rules-turn model shadow, Phase A draft): the same
// caller behaviours, now pinned on the only path left. EN + SW. Stand-in models only: GEMINI keys unset, no network,
// synthetic phone numbers. The reply model is down in these cases, so what is heard is the engines' own grounded line.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY; delete process.env.BRAIN_SAFE_MODE;
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const B1 = require('./helpers/b1Tenants');
const FR = require('./fixtures/dndSimTenant.json');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const inner = FR.picks.picks;
const DND = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows: inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version })) }), id: FR.row.id };
const DD = { ...DD0, id: DD0.tenantId };
const PHONE = '+254700000009'; // synthetic
const ACTION = { appointment: 'create_appointment', serviceRequest: 'create_service_request', escalate: 'escalate' };
const CLAIM = /\b(booked|i'?ve asked|will call you|they'll call|nimeweka|nimemwomba|atakupigia|watakupigia)\b/i;

/** Stand-in models: the understanding call answers from the script (null = model down for that turn); the reply call is down. */
function standIn(us) {
  let i = 0;
  return () => async ({ request }) => {
    if (request.generationConfig?.responseSchema?.properties?.intent) {
      const u = us[Math.min(i++, us.length - 1)];
      if (u) return { text: JSON.stringify({ answers: [], slots: {}, yes_no: null, wants_human: false, closing: false, ...u }) };
    }
    throw Object.assign(new Error('gemini http 503'), { code: 'http_503' });
  };
}

async function call(profile, turns, { lang = 'en', now = '2026-10-25T09:00:00Z', phone = PHONE, failWrites = false } = {}) {
  const writes = []; const stages = []; const out = [];
  const live = createBrainV2Live({
    env: {}, prewarm: false, log: () => {}, now: () => new Date(now), callSid: `HD_b2par_${Math.random().toString(36).slice(2)}`,
    onModelStage: (s) => stages.push(s),
    callerFile: { callerPhone: phone, openRows: [] },
    modelLeadStreamFor: standIn(turns.map((t) => (Array.isArray(t) ? t[1] : null))),
    applyTools: async (a) => {
      writes.push(a);
      const k = Object.keys(a)[0];
      return { results: [{ action: ACTION[k] || k, ok: !failWrites, status: failWrites ? 'failed' : 'succeeded', id: failWrites ? null : `row_${writes.length}` }] };
    },
  });
  for (const t of turns) {
    const text = Array.isArray(t) ? t[0] : t;
    const said = [];
    const r = await live.run({ text, profile, langLock: lang, onSentence: (s) => said.push(s.text) });
    out.push({ ...r, heard: said.join(' ') || r.line });
  }
  // the one path: every turn is the engines, one engines trace per turn
  for (const o of out) { assert.match(String(o.path || ''), /^brain_engines/, o.path); assert.ok(String(o.heard).trim(), 'never an empty turn'); }
  assert.equal(stages.filter((s) => s.kind === 'brain_engines').length, turns.length);
  return { out, writes, live, last: out[out.length - 1] };
}
const count = (s, re) => (String(s).match(re) || []).length;

test('B2 price: the catalogue price is said once (EN + SW)', async () => {
  const en = await call(DND, [['How much is a deep clean?', { intent: 'ask', answers: ['price'], slots: { service: 'Deep Clean' }, language: 'en' }]]);
  assert.match(en.last.heard, /Deep Clean is KSh 6,000–12,000/);
  assert.equal(count(en.last.heard, /6,000/g), 1);
  const sw = await call(DND, [['Deep clean ni pesa ngapi?', { intent: 'ask', answers: ['price'], slots: { service: 'Deep Clean' }, language: 'sw' }]], { lang: 'sw' });
  assert.match(sw.last.heard, /Deep Clean ni KSh 6,000–12,000/);
  assert.equal(count(sw.last.heard, /6,000/g), 1);
});

test('B2 quantity x unit price from the catalogue', async () => {
  const { last } = await call(DND, [['Sofa cleaning for a 5-seater, how much?', { intent: 'ask', answers: ['price'], slots: { service: 'Sofa Cleaning' }, language: 'en' }]]);
  assert.match(last.heard, /KSh 700 per seat, so KSh 3,500 for 5 seats/);
});

test('B2 payment: methods and deposit once, never stitched (EN + SW)', async () => {
  const en = await call(DND, [['How do I pay?', { intent: 'ask', answers: ['payment'], language: 'en' }]]);
  assert.match(en.last.heard, /M-Pesa/);
  assert.equal(count(en.last.heard, /M-Pesa Buy Goods/g), 1);
  const sw = await call(DND, [['Nalipa aje?', { intent: 'ask', answers: ['payment'], language: 'sw' }]], { lang: 'sw' });
  assert.match(sw.last.heard, /Unaweza kulipa kwa M-Pesa/);
  assert.equal(count(sw.last.heard, /amana/g), 1);
});

test('B2 coverage from the confirmed picks: yes for a served place, an honest no in Swahili for an excluded one', async () => {
  const yes = await call(DND, [['Do you come to Syokimau?', { intent: 'ask', answers: ['coverage'], slots: { place: 'Syokimau' }, language: 'en' }]]);
  assert.match(yes.last.heard, /Yes, we cover Syokimau/);
  const no = await call(DND, [['Mnafika Kibera?', { intent: 'ask', answers: ['coverage'], slots: { place: 'Kibera' }, language: 'sw' }]], { lang: 'sw' });
  assert.match(no.last.heard, /hatufiki Kibera/);
  assert.doesNotMatch(no.last.heard, /\bndio\b|we cover/i);
});

test('B2 out of area (Kericho): never an invented yes, no booking', async () => {
  for (const u of [{ intent: 'ask', answers: ['coverage'], slots: { place: 'Kericho' }, language: 'en' }, null]) {
    const { last, writes } = await call(DND, [['Do you come to Kericho?', u]]);
    assert.doesNotMatch(last.heard, /yes,? we (cover|come)|we cover kericho/i, last.heard);
    assert.equal(writes.length, 0);
  }
});

test('B2 all models down: the engines still answer from rules + templates (no repair line, no claim, no write)', async () => {
  const { out, writes } = await call(DND, [['Hello, I need help', null], ['How much is a deep clean?', null]]);
  for (const o of out) { assert.equal(o.repaired, undefined); assert.doesNotMatch(o.heard, CLAIM); }
  assert.equal(writes.length, 0);
});

test('B2 callback: the receipt (a saved row) comes before any "the owner will call you"', async () => {
  const turns = [['Can someone call me back?', { intent: 'callback', language: 'en' }], ['My name is Wanjiru', { intent: 'ask', slots: { name: 'Wanjiru' }, language: 'en' }], ['Yes', { intent: 'confirm', yes_no: 'yes', language: 'en' }]];
  const ok = await call(DND, turns);
  assert.doesNotMatch(ok.out[0].heard + ok.out[1].heard, CLAIM, 'no promise before the write');
  assert.match(ok.out[1].heard, /call you back on 0700 000 009/);
  assert.equal(ok.writes.filter((w) => w.serviceRequest).length, 1, 'one callback row');
  assert.match(ok.last.heard, /owner|call/i);
  const bad = await call(DND, turns, { failWrites: true });
  assert.match(bad.last.heard, /couldn't save/);
  assert.doesNotMatch(bad.last.heard, /\bI've asked\b/);
});

test('B2 booking: read-back, then one yes = exactly one row and the booked line (rules understanding)', async () => {
  const { out, writes } = await call(DD, ['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Yes'], { now: '2026-10-14T05:00:00Z' });
  assert.match(out[0].heard, /Shall I book it\?$/);
  assert.doesNotMatch(out[0].heard, /booked/);
  assert.match(out[1].heard, /booked for Friday 16 October at 10 AM/);
  assert.equal(writes.filter((w) => w.appointment).length, 1);
});

test('B2 empty snapshot (no catalogue, no hours): the B1 degradation, never an error or an invented price', async () => {
  for (const u of [null, { intent: 'ask', answers: ['price'], slots: { service: 'website' }, language: 'en' }]) {
    const { last, writes } = await call(B1.TENANTS.scalersBs(), [['How much is a website?', u]]);
    assert.match(last.heard, /team confirm/);
    assert.doesNotMatch(last.heard, /\d/);
    assert.equal(last.repaired, undefined);
    assert.equal(writes.length, 0);
  }
});

test('B2 safe mode (owner): the capture-only call on the live path, no catalogue answer', async () => {
  const p = B1.tenant({ id: 'dnd-safe', name: 'Done and Dusted', brainMode: 'safe', brainModeSource: 'owner', items: [B1.svc({ id: 'dc', name_en: 'Deep clean', price_amount: 6000 })] });
  const { last } = await call(p, ['Hi, how much is a deep clean?']);
  assert.equal(last.path, 'brain_engines_safe');
  assert.doesNotMatch(last.heard, /6,?000/);
  assert.match(last.heard, /team can follow up/);
});

test('B2 two places in one question: one answer per place, no contradiction (EN + SW, with and without the understanding)', async () => {
  const en = await call(DND, [['I just wanted to know if you guys have Kilimani or Westlands', { intent: 'ask', answers: ['coverage'], slots: { place: 'Kilimani' }, language: 'en' }]]);
  assert.equal(en.last.heard, 'Yes, we cover Kilimani. Yes, we cover Westlands.');
  const rules = await call(DND, [['Do you cover Kilimani or Westlands?', null]]);
  assert.equal(rules.last.heard, 'Yes, we cover Kilimani. Yes, we cover Westlands.');
  const sw = await call(DND, [['Mnafika Kilimani au Westlands?', null]], { lang: 'sw' });
  assert.equal(sw.last.heard, 'Ndio, tunafika Kilimani. Ndio, tunafika Westlands.');
});

test('B2 payment method not offered (crypto): only the real methods are said, never a yes to crypto', async () => {
  const { last } = await call(DND, [['Can I pay with crypto?', { intent: 'ask', answers: ['payment'], language: 'en' }]]);
  assert.match(last.heard, /M-Pesa/);
  assert.doesNotMatch(last.heard, /crypto|bitcoin/i);
});
