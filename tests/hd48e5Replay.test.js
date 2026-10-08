// HD_48e5ce069c12 (staging, 2026-10-08 ~12:00 EAT): the real 16-service
// Done and Dusted file. Locks for the faults found in that call.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const {
  coverageAskSpeech,
  coverageOfferToSpeak,
  groundFalseOutsideClaim,
} = require('../src/conversation/visitLocation');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const SNAPSHOT = require('./fixtures/tenants/done-and-dusted-staging.json');

const DUSTED = profileFromSnapshot(SNAPSHOT);

function stateFor(language, missingSlots = ['when', 'location']) {
  return {
    language: { current: language },
    goal: { missingSlots },
    caller: { name: 'Alvin', nameConfirmed: true },
    conversation: { answersReceived: [] },
  };
}

function polish(text, { language = 'en', caller = '', replyPartial = false, priorReply = '' } = {}) {
  const state = stateFor(language);
  state.conversation.answersReceived = [caller];
  return polishSpokenDetail(text, {
    profile: DUSTED,
    state,
    language,
    callerTurns: [caller],
    replyPartial,
    priorReply,
  }).text;
}

describe('HD_48e5 T5 corrected coverage line', () => {
  const T5_MODEL =
    'We cover Nairobi and its close surroundings. Kitengela is outside our main coverage area, but I can note your request for the team.';
  const T5_CALLER = 'Uh, do you have, like, Nairobi and Kitengela or something?';

  it('merges into the coverage sentence, drops "Yes,", and asks the next step', () => {
    const out = polish(T5_MODEL, { caller: T5_CALLER });
    assert.equal(
      out,
      'We cover Nairobi and its close surroundings, and Kitengela too. When would you like us to come?'
    );
    assert.doesNotMatch(out, /Yes,/);
    assert.equal((out.match(/We cover/g) || []).length, 1);
  });

  it('continues an already spoken coverage sentence when streamed', () => {
    const first = polish('We cover Nairobi and its close surroundings.', {
      caller: T5_CALLER,
      replyPartial: true,
    });
    const second = polish(
      'Kitengela is outside our main coverage area, but I can note your request for the team.',
      { caller: T5_CALLER, replyPartial: true, priorReply: first }
    );
    assert.equal(second, 'We also cover Kitengela.');
    const whole = polish(T5_MODEL, { caller: T5_CALLER });
    const tail = coverageOfferToSpeak(whole, `${first} ${second}`, 'en', stateFor('en'));
    assert.equal(tail, 'When would you like us to come?');
  });

  it('asks in Kiswahili for a Kiswahili reply', () => {
    const out = polish('Tunafika Nairobi na maeneo ya karibu. Kitengela iko nje ya eneo letu.', {
      language: 'sw',
      caller: 'Mnafika Kitengela?',
    });
    assert.equal(out, 'Tunafika Nairobi na maeneo ya karibu, na pia Kitengela. Ungependa tuje lini?');
  });

  it('keeps a true outside town and the model question', () => {
    const out = polish('Hatufiki Kitengela na Nakuru. Ungependa nikuandikie ujumbe?', {
      language: 'sw',
      caller: 'Mnafika Kitengela na Nakuru?',
    });
    assert.equal(out, 'Tunafika Kitengela, lakini hatufiki Nakuru. Ungependa nikuandikie ujumbe?');
  });

  it('does not repeat a town the previous sentence already covers', () => {
    const line = groundFalseOutsideClaim('Kitengela is outside our area.', DUSTED, 'en', {
      previous: 'We cover Nairobi and Kitengela.',
      mergeable: true,
    });
    assert.equal(line.line, '');
  });

  it('ends a local all-covered answer on the visit question', () => {
    assert.equal(
      coverageAskSpeech('Do you cover Kitengela?', DUSTED, 'en', stateFor('en')),
      'Yes, we cover Kitengela. When would you like us to come?'
    );
    assert.equal(
      coverageAskSpeech('Mnafika Kitengela?', DUSTED, 'sw', stateFor('sw', ['location'])),
      'Tunafika Kitengela. Tuje wapi?'
    );
  });
});
