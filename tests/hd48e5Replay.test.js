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

describe('HD_48e5 T5 coverage ask is answered locally', () => {
  const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
  const { extractConversationEntities } = require('../src/conversation/entityExtraction');
  const { resolveLocalReply } = require('../src/conversation/turnPolicy');

  function local(text, language) {
    let state = createBrainState(DUSTED);
    state = observeCallerTurn(state, {
      text,
      detectedLanguage: language,
      resolvedLanguage: language,
      profile: DUSTED,
      entities: extractConversationEntities(text, { profile: DUSTED, state }),
    });
    return resolveLocalReply({ text, state, profile: DUSTED, language });
  }

  it('hears "do you have Nairobi and Kitengela" as a coverage ask', () => {
    assert.deepEqual(local('Uh, do you have, like, Nairobi and Kitengela or something?', 'en'), {
      outcome: 'coverage',
      line: 'Yes, we cover Nairobi and Kitengela. When would you like us to come?',
    });
  });

  it('splits a covered and an uncovered town in Kiswahili', () => {
    assert.deepEqual(local('Mnafika Kitengela na Nakuru?', 'sw'), {
      outcome: 'coverage',
      line: 'Tunafika Kitengela, lakini hatufiki Nakuru. Naweza kukuachia ujumbe kwa timu yetu?',
    });
  });
});

describe('HD_48e5 T1/T2 catalogue line from the real 16-row file', () => {
  const { offerCatalogueLine } = require('../src/conversation/knownFacts');
  const { serviceFamilies } = require('../src/conversation/serviceFamilies');
  const { shapeCatalogueMouth } = require('../src/conversation/catalogueMouth');
  const { closingQuestionToSpeak } = require('../src/conversation/visitLocation');

  it('speaks service families, not the first four package rows', () => {
    const en = offerCatalogueLine('I was asking, uh, which service do you guys offer, like.', DUSTED, 'en');
    assert.equal(
      en,
      'We offer Apartment and House Cleaning, Deep Cleaning, Office Cleaning, and Mattress cleaning, and more. Which one do you need?'
    );
    assert.doesNotMatch(en, /1-Bedroom|2-Bedroom|3-Bedroom/);
    const sw = offerCatalogueLine('Mnafanya nini?', DUSTED, 'sw');
    assert.match(sw, /^Tuna Apartment na House Cleaning, Deep Cleaning, Office Cleaning, na Mattress cleaning, na zingine\. Unahitaji gani\?$/);
  });

  it('derives families from any file, not this tenant', () => {
    const salon = serviceFamilies([
      { name: 'Haircut' },
      { name: 'Kids haircut' },
      { name: 'Box braids' },
      { name: 'Knotless braids' },
      { name: 'Manicure' },
    ]).map((f) => f.label);
    assert.deepEqual(salon, ['Haircut', 'Braids', 'Manicure']);
    const byCategory = serviceFamilies([
      { name: 'Sofa', category: 'Upholstery' },
      { name: 'Armchair', category: 'Upholstery' },
      { name: 'Rug', category: 'Floors' },
    ]).map((f) => f.label);
    assert.deepEqual(byCategory, ['Upholstery', 'Rug']);
  });

  it('keeps exact names when the file is short', () => {
    const short = {
      ...DUSTED,
      servicesCatalog: DUSTED.servicesCatalog.slice(11, 14),
    };
    assert.equal(
      offerCatalogueLine('What services do you offer?', short, 'en'),
      'We offer Sofa Cleaning, Carpet Cleaning, and Interior Window Cleaning. Which one do you need?'
    );
  });

  it('does not stack "Which service do you need?" on the model question (T2)', () => {
    const caller = "Yeah, you're speaking with Alvin.";
    const state = {
      caller: { name: 'Alvin', nameConfirmed: true, nameJustConfirmed: true },
      conversation: { answersReceived: [caller], catalogueListed: true },
      language: { current: 'en' },
    };
    const opts = { profile: DUSTED, state, language: 'en', callerText: caller };
    const dump =
      'We offer carpet, sofa, mattress, window, and house cleaning, as well as deep cleaning, move-in cleans, post-construction, and office cleaning.';
    const ask = 'Which one do you need today, Alvin?';
    assert.equal(shapeCatalogueMouth(dump, { ...opts, replyPartial: true }), '');
    assert.equal(shapeCatalogueMouth(ask, { ...opts, replyPartial: true }), ask);
    assert.equal(shapeCatalogueMouth(`${dump} ${ask}`, opts), ask);
  });

  it('speaks the finished reply question once when no streamed sentence asked', () => {
    assert.equal(
      closingQuestionToSpeak('Sure. Which service do you need?', 'Sure.'),
      'Which service do you need?'
    );
    assert.equal(closingQuestionToSpeak('Sure. Which one?', 'Sure. Which one?'), '');
    assert.equal(closingQuestionToSpeak('Okay.', 'Okay.'), '');
  });
});

describe('HD_48e5 replay fixture', () => {
  const { replayCall } = require('../src/speech/replayVoice');
  const FIXTURE = require('./fixtures/voice-calls/HD_48e5ce069c12.json');

  it('replays t5 as one coverage sentence that ends on the next step', async () => {
    const call = await replayCall(FIXTURE);
    const turns = (call.turns || []).filter((r) => r.recordKind === 'turn');
    const t5 = turns.find((r) => r.turnIndex === 5);
    const tts = (t5.stages || []).filter((s) => s.stage === 'tts').pop();
    assert.equal(
      tts.before,
      'We cover Nairobi and its close surroundings, and Kitengela too. When would you like us to come?'
    );
    assert.doesNotMatch(tts.before, /Yes, we cover|outside/);
  });

  it('carries the real 16-row file and the picked coverage list', () => {
    assert.equal(FIXTURE.servicesCatalog.length, 16);
    assert.ok(FIXTURE.businessPolicies.coverage_areas.includes('place:kitengela'));
  });
});
