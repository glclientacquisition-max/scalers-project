'use strict';
// DnD 10-question sim root fixes: one assembler dedupe, one payment fact, place statements owed coverage,
// quantity x unit price, booking pre-check, confirmed area picks as the single coverage source. EN + SW.
const test = require('node:test');
const assert = require('node:assert/strict');
for (const [k, v] of Object.entries({ BRAIN_V2_FACT_STORE: '1', BRAIN_V2_NLU_GAPS: '1', BRAIN_V2_CONV_STATE: 'on', BRAIN_V2_REPLY_OWNER: 'on', BRAIN_V2_COMMIT_SAFETY: '1', BRAIN_V2_TOPIC_PROPOSALS: '1', BRAIN_PLAIN_SERVICE_CATEGORIES: '1', VOICE_AREA_FEES: 'on' })) process.env[k] = v;
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const AC = require('../src/conversation/v2/areaCoverage');
const RF = require('../src/conversation/v2/replyFacts');
const OF = require('../src/conversation/v2/ownerFacts');
const OW = require('../src/conversation/v2/owed');
const CP = require('../src/conversation/v2/callPlan');
const ML = require('../src/conversation/v2/modelLead');
const FR = require('./fixtures/dndSimTenant.json');

const inner = FR.picks.picks;
const areaPicksRows = inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version }));
const P = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows }), id: FR.row.id };
const NOPICKS = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta) }), id: FR.row.id };
const ENV = { BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V2_MODEL: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_CALL_CORE: 'on', BRAIN_MODEL_LEAD: 'on', BRAIN_MODEL_LEAD_SPLIT: 'on', BRAIN_LEAD_MODEL_ID: 'lite', BRAIN_LEAD_BACKUP_MODEL_ID: 'flash' };

// template path: every model 503s, as in the DnD sim
async function say(text, lang = 'en', profile = P, { rows = [], u = null } = {}) {
  // the reply model always fails (template path); the understanding call answers with `u` when given
  const stream = () => async ({ request }) => { const p = JSON.parse(request.contents[0].parts[0].text); if (p.UNDERSTAND && u) return { text: JSON.stringify(u) }; throw Object.assign(new Error('gemini http 503'), { code: 'http_503' }); };
  const live = createBrainV2Live({ env: ENV, applyTools: async (a) => ({ results: [{ action: Object.keys(a)[0], ok: true, status: 'ok', id: 'x' }] }), modelLeadStreamFor: stream, v1DraftStreamFor: () => async () => ({ calls: [] }), shadowModel: async () => ({ calls: [] }), shadowBackupModel: async () => ({ calls: [] }), prewarm: false, now: () => new Date('2026-10-25T09:00:00Z'), log: () => {}, callerFile: { contactName: null, callerPhone: '+254700000009', openRows: rows } });
  const said = []; const r = await live.run({ text, profile, langLock: lang, onSentence: (s) => said.push(s.text) });
  return said.join(' ') || r.line || '';
}
const count = (s, re) => (s.match(re) || []).length;





test('confirmed picks are the single coverage source: Kamakis, Kibera exclusion', async () => {
  assert.doesNotMatch(await say('Do you come to Kamakis?'), /Yes, we cover Kamakis/);
  assert.match(await say('Do you cover Kibera?'), /Sorry, we don't cover Kibera/);
  assert.match(AC.line(AC.resolve('Kibera', P), 'sw'), /Samahani, hatufiki Kibera/);
  assert.equal(AC.resolve('Kibera', P).source, 'picks');
});

test('no-picks tenant: legacy fallback never confirms an unknown place', () => {
  const r = AC.resolve('Kamakis', NOPICKS);
  assert.notEqual(r.status, 'covered');
  assert.match(AC.line(r, 'en'), /check with the owner|Which area/i);
  assert.match(AC.line(r, 'sw'), /Nitaangalia na mmiliki|karibu na eneo gani/i);
  // a same-named town row ("Kiambu" the town) does not cover the whole county
  // DnD legacy lists the TOWN Kiambu, not the county: Limuru (Kiambu county, unlisted) is not covered
  assert.notEqual(AC.resolve('Limuru', NOPICKS).status, 'covered');
  // a known county where the owner lists nothing stays an honest no
  assert.equal(AC.resolve('Kericho', NOPICKS).status, 'outside');
});


test('every owed-answer type renders in Swahili, scoped to its sub-question (no extra sub-topics)', () => {
  const ctx = { profile: P, text: 'sofa viti 5', machine: { slots: {} }, caller: { candidate: 'Wanjiru', upcoming: [{ service: 'Sofa Cleaning', date: '2026-10-26' }] } };
  const kib = ML.coverageFor('Kibera', P).places[0];
  const SAMPLE = {
    coverage: { sub: 'Kibera', row: kib }, price: { sub: 'Sofa Cleaning' }, payment: {}, policy: { sub: 'cancellation' }, hours: {},
    duration: { sub: '2-Bedroom Standard Clean' }, hours_fit: { date: '2026-10-31', time: '10:00' }, identity: {}, agent_name: {}, booking_status: {}, clarify: { sub: 'cancel' },
  };
  assert.deepEqual(Object.keys(SAMPLE).sort(), [...OW.TOPICS].sort(), 'a new owed-answer type needs a sample here (and an sw rendering)');
  const EN_WORDS = /\b(the|we|you|our|is|are|and|it|have|cover|pay|takes|open)\b/i;
  for (const t of OW.TOPICS) {
    const sw = OW.render({ topic: t, lang: 'sw', ...SAMPLE[t] }, ctx); const en = OW.render({ topic: t, lang: 'en', ...SAMPLE[t] }, ctx);
    assert.ok(sw && en, `${t}: en+sw render`);
    assert.notEqual(sw, en, `${t}: sw differs from en`);
    assert.doesNotMatch(sw.replace(/M-Pesa[^.]*|Standard Clean|Sofa Cleaning|Buy Goods|Till|Paybill|with your phone number as the account|or cash/gi, ''), EN_WORDS, `${t}: no English leak in "${sw}"`);
  }
  // scoped: the cancellation answer is only the cancellation fact (no reschedule / late-arrival extras)
  const of = OF.ownerFacts(P); const cancel = OF.spoken(of.byTopic.get('cancellation'), 'en');
  assert.equal(OW.render({ topic: 'policy', sub: 'cancellation', lang: 'en' }, ctx), cancel);
  for (const other of of.facts.filter((f) => f.topic !== 'cancellation' && f.family !== 'faq')) assert.ok(!cancel.includes(f0(other.text)), `leaks ${other.topic}`);
  const list = OW.collect({ questions: [{ type: 'policy', subject: 'cancellation' }], text: 'Can I cancel?', profile: P, lang: 'sw' });
  assert.deepEqual(list.map((o) => `${o.topic}:${o.sub}:${o.lang}`), ['policy:cancellation:sw']);
});
const f0 = (t) => String(t || '').split(/(?<=[.!?])\s/)[0];


const MON = [{ id: 'r1', caller_phone: '+254700000009', service_name: '2-Bedroom Standard Clean', status: 'confirmed', window_start: '2026-10-26T07:00:00Z', place: 'Westlands' }];

