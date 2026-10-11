const { test } = require('node:test');
const assert = require('node:assert/strict');
const cf = require('../src/conversation/callFacts');
const { parseReviewJson, REVIEW_SYSTEM } = require('../src/conversation/callTranscriptReview');

test('normalizeCallFacts drops unknown enums and keeps typed values', () => {
  const f = cf.normalizeCallFacts({
    intent: 'price_check',
    secondary_intents: ['delivery_question', 'nonsense', 'price_check'],
    outcome: 'lost',
    lost_reason: 'made_up',
    products_mentioned: [{ name: 'A4 ream', qty: '3', quoted_price_ksh: 'KSh 650' }, { name: '' }],
    price_objection: true,
    objection_price_ksh: '550',
    competitor_mentioned: 'none',
    est_value_ksh: null,
    caller_area: 'Kilimani',
    language: 'Klingon',
    sentiment: 'negative',
    unanswered_question: 'Do you deliver to Ruaka?',
  });
  assert.equal(f.intent, 'price_check');
  assert.deepEqual(f.secondary_intents, ['delivery_question', 'price_check']);
  assert.equal(f.lost_reason, 'other');
  assert.deepEqual(f.products_mentioned, [{ name: 'A4 ream', qty: 3, quoted_price_ksh: 650 }]);
  assert.equal(f.competitor_mentioned, null);
  assert.equal(f.language, null);
  assert.equal(f.objection_price_ksh, 550);
});

test('lost_reason only kept for lost calls; legacy intents mapped', () => {
  assert.equal(cf.normalizeCallFacts({ outcome: 'info_only', lost_reason: 'price_too_high' }).lost_reason, null);
  assert.equal(cf.normalizeCallFacts({ intent: 'human' }).intent, 'human_request');
  assert.equal(cf.normalizeCallFacts(null).intent, null);
});

test('detectLanguage: Sheng, Swahili, mixed, English', () => {
  assert.equal(cf.detectLanguage('niaje msee, hiyo simu ni doh ngapi poa'), 'sheng');
  assert.equal(cf.detectLanguage('habari, bei ya unga ni ngapi tafadhali'), 'sw');
  assert.equal(cf.detectLanguage('habari, I want to know bei ni ngapi please'), 'mixed');
  assert.equal(cf.detectLanguage('hello how much do you have for the printer'), 'en');
  assert.equal(cf.detectLanguage('ok'), null);
});

test('buildCallFactsRow links catalogue items, estimates value, sets EAT time', () => {
  const row = cf.buildCallFactsRow({
    call: { id: 'c1', tenant_id: 't1', created_at: '2026-10-11T17:30:00Z' },
    facts: cf.normalizeCallFacts({ intent: 'order_place', outcome: 'sale_or_order', products_mentioned: [{ name: 'a4 ream', qty: 2 }], language: 'sw' }),
    review: { confidence: 0.8 },
    callerText: 'niaje msee nataka ream mbili poa',
    catalogue: [{ name: 'A4 Ream', pricing: { mode: 'fixed', amount_ksh: 650 } }],
  });
  assert.equal(row.products_mentioned[0].catalogue_key, 'a4 ream');
  assert.equal(row.products_mentioned[0].listed_price_ksh, 650);
  assert.equal(row.est_value_ksh, 1300);
  assert.equal(row.time_of_day, 'evening');
  assert.equal(row.hour_eat, 20);
  assert.equal(row.language, 'sheng'); // marker tie-break over a model "sw"
  assert.equal(row.source, 'review');
});

test('owner corrections are never overwritten by a later review', () => {
  const row = { intent: 'price_check', outcome: 'info_only', lost_reason: null, source: 'review' };
  const merged = cf.mergeWithExisting(row, { source: 'owner', intent: 'order_place', outcome: 'lost', lost_reason: 'price_too_high' });
  assert.deepEqual([merged.intent, merged.outcome, merged.lost_reason, merged.source], ['order_place', 'lost', 'price_too_high', 'owner']);
  assert.equal(merged.review_snapshot.intent, 'price_check');
  assert.equal(cf.mergeWithExisting(row, { source: 'review' }), row);
});

test('review prompt asks for facts in the shared taxonomy; parser returns them', () => {
  for (const i of cf.taxonomy.intents) assert.ok(REVIEW_SYSTEM.includes(i.id), i.id);
  for (const o of cf.taxonomy.outcomes) assert.ok(REVIEW_SYSTEM.includes(o.id), o.id);
  const out = parseReviewJson(JSON.stringify({ want: 'Price of a ream', needs_human: false, facts: { intent: 'price_check', outcome: 'info_only' } }));
  assert.equal(out.facts.intent, 'price_check');
  const noFacts = parseReviewJson(JSON.stringify({ want: 'x', needs_human: false }));
  assert.equal(noFacts.facts.intent, null);
});

test('daily data-quality tick runs once per EAT day after 03:00', async () => {
  const { startDataQualityDaily } = require('../src/lib/dataQualityDaily');
  let n = 0;
  const job = startDataQualityDaily({ rpc: async () => { n += 1; return { data: 3, error: null }; }, log: {}, intervalMs: 1e9 });
  clearInterval(job.timer);
  assert.equal(await job.tick(new Date('2026-10-11T23:00:00Z')), false); // 02:00 EAT
  assert.equal(await job.tick(new Date('2026-10-12T01:00:00Z')), true); // 04:00 EAT
  assert.equal(await job.tick(new Date('2026-10-12T05:00:00Z')), false); // same day
  assert.equal(n, 1);
});
