'use strict';
// Architecture seam: ticket → one shop line. A second shop proves the same
// kinds scale. The model cannot write the mouth.

const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const { compileAskReceipt, resolveAsk } = require('../src/conversation/v2/askReceipt');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const JIRANI = {
  ...DD,
  vertical: 'home_services',
  businessPolicies: {
    payment: 'M-Pesa (Till) or cash after the job. No payment before the team arrives.',
    delivery: 'Home visits in Kilimani (no travel fee), Kileleshwa, Lavington and Westlands (KSh 300 travel fee), and Karen (KSh 800 travel fee).',
    deposit: 'No deposit for homes under 4 bedrooms.',
    cancellation: 'Free to reschedule up to 12 hours before the visit.',
    warranty: 'If something was missed, tell us within 24 hours and we come back to redo it free.',
    returns: '',
    coverage_areas: ['place:kilimani', 'place:kileleshwa', 'place:lavington', 'place:westlands', 'place:karen'],
  },
  service_areas: {
    areas: [
      { id: 'place:kilimani', source: 'owner', confirmed: true, fee_mode: 'free', fee_ksh: null, modes: ['visit'] },
      { id: 'place:kileleshwa', source: 'owner', confirmed: true, fee_mode: 'fixed', fee_ksh: 300, modes: ['visit'] },
      { id: 'place:karen', source: 'owner', confirmed: true, fee_mode: 'fixed', fee_ksh: 800, modes: ['visit'] },
    ],
  },
};

const JIRANI_NO_FEES = {
  ...JIRANI,
  service_areas: undefined,
  serviceAreas: undefined,
  areaTerms: undefined,
};

const WESTLANDS = {
  vertical: 'home_services',
  businessPolicies: {
    payment: 'Cash only after the job.',
    delivery: 'We visit Westlands only. Travel is two hundred shillings.',
    cancellation: 'No change after the team is on the way.',
    returns: 'No refunds.',
    coverage_areas: ['place:westlands'],
  },
  service_areas: {
    areas: [
      { id: 'place:westlands', source: 'owner', confirmed: true, fee_mode: 'fixed', fee_ksh: 200, modes: ['visit'] },
    ],
  },
};

test('compile: trusted Karen fee is one line; no map; no invent', () => {
  const line = compileAskReceipt(JIRANI, { kind: 'come_cost', place: 'Karen' }, 'en');
  assert.match(line, /eight hundred shillings/i);
  assert.match(line, /Karen/i);
  assert.doesNotMatch(line, /Kilimani|Westlands|Home visits|KSh 500/i);
});

test('compile: missing Locations fees is a hole, not the delivery paragraph', () => {
  const line = compileAskReceipt(JIRANI_NO_FEES, { kind: 'come_cost', place: 'Karen' }, 'en');
  assert.match(line, /Karen/i);
  assert.doesNotMatch(line, /eight hundred|Home visits in Kilimani/i);
});

test('compile: empty refund stays unknown; cancel rules stay the file', () => {
  assert.match(compileAskReceipt(JIRANI, { kind: 'refund' }, 'en'), /don't have that on file/i);
  assert.match(compileAskReceipt(JIRANI, { kind: 'cancel_rules' }, 'en'), /12 hours/i);
  assert.equal(compileAskReceipt(JIRANI, { kind: 'cancel_visit' }, 'en'), '');
  assert.equal(compileAskReceipt(JIRANI, { kind: 'unknown' }, 'en'), '');
});

test('same kinds, second shop: Westlands 200, not Jirani 800', () => {
  const a = compileAskReceipt(JIRANI, { kind: 'come_cost', place: 'Karen' }, 'en');
  const b = compileAskReceipt(WESTLANDS, { kind: 'come_cost', place: 'Westlands' }, 'en');
  assert.match(a, /eight hundred/i);
  assert.match(b, /two hundred/i);
  assert.doesNotMatch(b, /eight hundred|Karen/i);
  assert.match(compileAskReceipt(WESTLANDS, { kind: 'cancel_rules' }, 'en'), /on the way/i);
  assert.doesNotMatch(compileAskReceipt(WESTLANDS, { kind: 'cancel_rules' }, 'en'), /12 hours/i);
});

const ROWS = [
  { say: 'Are like the fare to Karen?', lang: 'en', job: 'speak', kind: 'come_cost', has: /eight hundred/i, not: /Kilimani|Shall I go ahead/i },
  { say: 'Nilikuwa nataka kujua ada ya kuja Karen ni ngapi.', lang: 'sw', job: 'speak', kind: 'come_cost', has: /Karen|mia nane|eight hundred/i, not: /Kilimani|Shall I go ahead/i },
  { say: 'How can I pay?', lang: 'en', job: 'speak', kind: 'pay', has: /Till|cash after the job/i, not: /Shall I go ahead/i },
  { say: 'Do you give refunds?', lang: 'en', job: 'speak', kind: 'refund', has: /don't have that on file/i, not: /12 hours/i },
  { say: 'Or how do you handle cancellation?', lang: 'en', job: 'speak', kind: 'cancel_rules', has: /12 hours/i, not: /Shall I go ahead/i },
  { say: 'What is your cancellation policy?', lang: 'en', job: 'speak', kind: 'cancel_rules', has: /12 hours/i, not: /Cancel your/i },
  { say: 'Cancellation?', lang: 'en', job: 'speak', kind: 'cancel_rules', has: /12 hours/i, not: /Shall I go ahead/i },
  { say: 'I want to cancel my booking.', lang: 'en', job: 'write', kind: 'cancel_visit', lineEmpty: true },
  { say: 'Book sofa cleaning Friday.', lang: 'en', job: 'write', kind: 'book', lineEmpty: true },
];

test('resolveAsk table: Jirani ear and mouth', async () => {
  for (const row of ROWS) {
    const got = await resolveAsk({ text: row.say, profile: JIRANI, lang: row.lang });
    assert.equal(got.job, row.job, row.say);
    assert.equal(got.kind, row.kind, row.say);
    if (row.lineEmpty) {
      assert.equal(got.line, '', row.say);
      continue;
    }
    assert.match(got.line, row.has, `${row.say} => ${got.line}`);
    assert.doesNotMatch(got.line, row.not, row.say);
  }
});

test('classifier may pick a drawer; it still cannot invent the fee', async () => {
  const classify = async () => ({ kind: 'come_cost', place: 'Karen', say: 'The fee is KSh 500' });
  const got = await resolveAsk({
    text: 'How much to come that side, Karen?',
    profile: JIRANI,
    lang: 'en',
    classify,
  });
  assert.equal(got.kind, 'come_cost');
  assert.match(got.line, /eight hundred/i);
  assert.doesNotMatch(got.line, /KSh 500|five hundred/i);
});

test('live machine still speaks the same Karen and cancel receipts', async () => {
  const fare = await V2.runTurn(V2.createState({ profile: JIRANI, callerPhone: '+254700000001' }), {
    text: 'ada ya kuja Karen ni ngapi',
    profile: JIRANI,
    now: new Date('2026-10-14T05:00:00Z'),
    handlers: {},
    langLock: 'sw',
  });
  assert.match(fare.line, /Karen|mia nane|eight hundred/i);
  assert.doesNotMatch(fare.line, /Kilimani|Westlands/i);

  const rule = await V2.runTurn(V2.createState({ profile: JIRANI, callerPhone: '+254700000001' }), {
    text: 'Or how do you handle cancellation?',
    profile: JIRANI,
    now: new Date('2026-10-14T05:00:00Z'),
    handlers: { updateAppointment: async () => { throw new Error('no write'); } },
    langLock: 'en',
  });
  assert.match(rule.line, /12 hours/i);
  assert.doesNotMatch(rule.line, /Shall I go ahead|Cancel your/i);
});

test('R3: bare how much / ngapi is not come_cost; travel lexicon still is', async () => {
  const bare = await resolveAsk({ text: 'How much is sofa cleaning?', profile: JIRANI, lang: 'en' });
  assert.notEqual(bare.kind, 'come_cost', bare.kind);
  assert.doesNotMatch(bare.line || '', /eight hundred|travel|Kilimani|Home visits/i);

  const swBare = await resolveAsk({ text: 'Bei ya sofa cleaning ni ngapi?', profile: JIRANI, lang: 'sw' });
  assert.notEqual(swBare.kind, 'come_cost', swBare.kind);

  const fare = await resolveAsk({ text: 'How much is the travel fee to Karen?', profile: JIRANI, lang: 'en' });
  assert.equal(fare.kind, 'come_cost');
  assert.match(fare.line, /eight hundred/i);

  const ada = await resolveAsk({ text: 'Ada ya kuja Karen ni ngapi?', profile: JIRANI, lang: 'sw' });
  assert.equal(ada.kind, 'come_cost');
});

test('R3 live machine: service how much is price/which_price, not travel-fee dump', async () => {
  const prev = process.env.BRAIN_V2_COMMIT_SAFETY;
  const prevOwns = process.env.BRAIN_V2_OWNS_CALL;
  process.env.BRAIN_V2_COMMIT_SAFETY = '1';
  delete process.env.BRAIN_V2_OWNS_CALL;
  try {
    const st = V2.createState({ profile: JIRANI, callerPhone: '+254700000001' });
    const got = await V2.runTurn(st, {
      text: 'How much is sofa cleaning?',
      profile: JIRANI,
      now: new Date('2026-10-14T05:00:00Z'),
      handlers: {},
      langLock: 'en',
    });
    // Travel-fee dump (come_cost) lists estates / "travel fee" — service price may still say "eight hundred".
    assert.doesNotMatch(got.line, /travel fee|Home visits in Kilimani|We (?:also )?cover|come to (?:Karen|Kilimani)|ada ya kuja/i);
    assert.match(got.line, /Sofa Cleaning|sofa|Which service|quote|don't have a price/i);
  } finally {
    if (prev === undefined) delete process.env.BRAIN_V2_COMMIT_SAFETY; else process.env.BRAIN_V2_COMMIT_SAFETY = prev;
    if (prevOwns === undefined) delete process.env.BRAIN_V2_OWNS_CALL; else process.env.BRAIN_V2_OWNS_CALL = prevOwns;
  }
});
