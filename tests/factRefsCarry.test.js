'use strict';
// Staging retest HD_b070f6939775 (pin 6201b4da, VOICE_FACT_REFS on): after
// "How much is sofa cleaning?" the caller asked about the Kileleshwa travel
// fee three times and heard the sofa price each time. The local price line
// (speechGuard.groundFilePriceLine walking back to an earlier caller turn, and
// catalogueMouth's carried-over service) answered a question about something
// else, and kept answering after the call had moved on to the fee. Also: the till turn invented
// "given when you pay", and the price line said "is From KSh".
// Seams: resolveLocalReply + groundFilePriceLine (what server.js commits as
// the speak packet), polishSpokenDetail. Expected values written by hand.
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { groundFilePriceLine } = require('../src/conversation/speechGuard');
const { createBrainState } = require('../src/conversation/brainState');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');

function withFlag(value, fn) {
  const prev = process.env.VOICE_FACT_REFS;
  if (value == null) delete process.env.VOICE_FACT_REFS;
  else process.env.VOICE_FACT_REFS = value;
  try {
    return fn();
  } finally {
    if (prev == null) delete process.env.VOICE_FACT_REFS;
    else process.env.VOICE_FACT_REFS = prev;
  }
}

const FALLBACK = "I'll check with the team and they'll call you back.";
function profile() {
  return {
    businessName: 'Usafi Mtaa',
    agentName: 'Akinyi',
    unknownAnswerFallback: FALLBACK,
    servicesCatalog: [
      { name: 'Deep clean, 1 bedroom', price_range: 'KSh 6,500', source: 'owner', confirmed: true },
      { name: 'Sofa cleaning', price_range: 'From KSh 2,500', source: 'owner', confirmed: true },
    ],
  };
}

// The caller turns of HD_b070f6939775 t1-t5, in order.
const SEQUENCE = [
  'And how much is Sofa cleaning?',
  'Uh, how much is the travel fee to Kileleshwa?',
  'How much is the travel fee to Kileleshwa?',
  'And how much is the.',
  'Travel fee?',
];

/** What the local speak packet would say on each turn (server.js order). */
function replay(sequence = SEQUENCE) {
  const prof = profile();
  const state = createBrainState(prof);
  const turns = [];
  const said = [];
  for (const text of sequence) {
    turns.push(text);
    state.conversation.answersReceived = turns.slice();
    const local = resolveLocalReply({ text, state, profile: prof, language: 'en' });
    const grounded = groundFilePriceLine({ profile: prof, text, callerTurns: turns, state, language: 'en' });
    const line = (local && local.line) || grounded || '';
    // Brain keeps the named service as an entity.
    if (/sofa/i.test(text)) state.entities.service = { value: 'Sofa cleaning', confirmed: true };
    said.push(line);
  }
  return said;
}

test('HD_b070f6939775, flag on: the sofa price answers only the sofa question, never the fee turns', () => {
  withFlag('on', () => {
    assert.deepEqual(replay(), [
      'Sofa cleaning is from KSh 2,500.',
      '', // fee question: no local price, the model answers {fee.kileleshwa}
      '',
      '', // a cut-off "how much is the." after the fee turns: the call moved on
      '',
    ]);
  });
});

test('HD_b070f6939775, flag off: the old carry-over is unchanged (documents the bug)', () => {
  withFlag(null, () => {
    const said = replay();
    assert.equal(said[0], 'Sofa cleaning is From KSh 2,500.');
    assert.equal(said[1], 'Sofa cleaning is From KSh 2,500.');
    assert.equal(said[3], 'Sofa cleaning is From KSh 2,500.');
  });
});

test('a bare "how much is it?" still gets the service it follows; not after a fee question', () => {
  withFlag('on', () => {
    // Named first, then bare price asks (a re-ask is answered again).
    assert.deepEqual(replay(['I need sofa cleaning.', 'How much is it?', 'Ni pesa ngapi?']), [
      '',
      'Sofa cleaning is from KSh 2,500.',
      'Sofa cleaning is from KSh 2,500.',
    ]);
    // A fee question in between: the bare ask no longer means sofa.
    assert.deepEqual(replay(['I need sofa cleaning.', 'Is there a travel fee to Karen?', 'How much is it?']), ['', '', '']);
    // Asking by name again is a new question and is answered again.
    assert.deepEqual(replay(['How much is sofa cleaning?', 'How much is sofa cleaning?']), [
      'Sofa cleaning is from KSh 2,500.',
      'Sofa cleaning is from KSh 2,500.',
    ]);
  });
});

test('model path, flag on: a dropped number on the fee turn is not repaired with the earlier sofa price', () => {
  withFlag('on', () => {
    const prof = profile();
    const state = createBrainState(prof);
    state.entities.service = { value: 'Sofa cleaning', confirmed: true };
    const res = polishSpokenDetail('The travel fee to Kileleshwa is KSh 450.', {
      state,
      profile: prof,
      language: 'en',
      callerTurns: ['And how much is Sofa cleaning?', 'How much is the travel fee to Kileleshwa?'],
    });
    assert.doesNotMatch(res.text, /sofa/i);
  });
});

test('HD_b070f6939775 till turn, flag on: no number on file gives the fallback, not an invented process', () => {
  withFlag('on', () => {
    const prof = profile();
    const en = polishSpokenDetail(
      'Our Till number is given when you pay after the job is completed. Would you like to book a cleaning service?',
      { state: createBrainState(prof), profile: prof, language: 'en', callerTurns: ["What's your till number?"] }
    );
    assert.equal(en.text, `${FALLBACK} Would you like to book a cleaning service?`);
    assert.ok(en.dropReasons.includes('pay_number_unknown'));
    // Swahili caller: the business line is English, so the team default.
    const sw = polishSpokenDetail('Namba ya till itatolewa baada ya kazi.', {
      state: createBrainState(prof),
      profile: prof,
      language: 'sw',
      callerTurns: ['Namba ya till ni gani?'],
    });
    assert.equal(sw.text, 'Wacha niulize timu kisha nikujulishe.');
    // The ID route: an unknown {pay.mpesa_till} is the same line.
    const ref = polishSpokenDetail('Our till number is {pay.mpesa_till}.', {
      state: createBrainState(prof),
      profile: prof,
      language: 'en',
      callerTurns: ["What's your till number?"],
    });
    assert.equal(ref.text, FALLBACK);
  });
  withFlag(null, () => {
    const prof = profile();
    const off = polishSpokenDetail('Our till number is given when you pay after the job.', {
      state: createBrainState(prof),
      profile: prof,
      language: 'en',
      callerTurns: ["What's your till number?"],
    });
    assert.equal(off.text, 'Our till number is given when you pay after the job.');
  });
});

test('FACT CARD tells the model an unlisted payment number is still written as its ID', () => {
  const factSheet = require('../src/conversation/factSheet');
  const card = factSheet.formatFactCard(factSheet.buildFactSheet(profile()));
  assert.match(card, /not listed here is not on file: still write its ID \(\{pay\.mpesa_till\}/);
  assert.match(card, /Never say when, where or how a number is given\./);
});
