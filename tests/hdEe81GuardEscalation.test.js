// Regression locks for HD_ee813bcf6248 (staging kitchen-sink 2e4b3669,
// 2026-10-08 16:45-16:48 EAT). Every caller and model line below is from that
// call's voice_turn_traces. Run: node --test tests/hdEe81GuardEscalation.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  KISWAHILI_NUMBER_TIME_WORDS,
  bindSpokenPlace,
  canonicalPlaceName,
} = require('../src/conversation/kenyaPlaces');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { looksLikeHoursAsk, hoursAskLine } = require('../src/conversation/knownFacts');
const brain = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { appendFinalPart, joinUtteranceParts } = require('../src/speech/utteranceJoin');
const { queueToolOutcome, takeToolOutcome } = require('../src/conversation/toolOutcomeQueue');
const {
  coverageAnswerWithoutNextStep,
  coverageNextStepFor,
} = require('../src/conversation/coverageNextStep');
const { replayCall } = require('../src/speech/replayVoice');
const { scoreFixtureReplay } = require('../src/speech/voiceScore');

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'voice-calls', 'HD_ee813bcf6248.json'), 'utf8')
);
const PROFILE = {
  businessName: FIXTURE.businessName,
  vertical: FIXTURE.vertical,
  servicesCatalog: FIXTURE.servicesCatalog,
  businessPolicies: FIXTURE.businessPolicies,
  hoursSchedule: FIXTURE.hoursSchedule,
};
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const T16_CALLER = 'Is fine, ama you guys operate until what time?';
const T16_MODEL =
  'Tunafanya kazi kila siku kuanzia saa mbili asubuhi hadi saa kumi na mbili jioni (8:00 AM - 6:00 PM EAT).';
const T17_CALLER = 'You guys operate until what time?';
const T17_MODEL =
  'Tunafungua kila siku kuanzia saa mbili asubuhi hadi saa kumi na mbili jioni (8:00 AM - 6:00 PM).';

function guard(model, caller, language = 'en') {
  return polishSpokenDetail(model, {
    profile: PROFILE,
    callerTurns: [caller],
    language,
    state: {},
    toolResults: [],
    capabilities: {},
  });
}

describe('1. Kiswahili number and time words are never places', () => {
  it('no word on the list binds a place, exact or fuzzy', () => {
    assert.ok(KISWAHILI_NUMBER_TIME_WORDS.size >= 40);
    for (const word of KISWAHILI_NUMBER_TIME_WORDS) {
      assert.deepEqual(bindSpokenPlace(word), [], `exact ${word}`);
      assert.deepEqual(bindSpokenPlace(word, { fuzzy: true }), [], `fuzzy ${word}`);
      assert.equal(canonicalPlaceName(word), '', `canonical ${word}`);
    }
  });

  it('covers the live false hits: mbili (Kisii), usiku, mwaka, kutwa, mbele, kamili', () => {
    for (const word of ['mbili', 'usiku', 'mwaka', 'kutwa', 'mbele', 'kamili']) {
      assert.ok(KISWAHILI_NUMBER_TIME_WORDS.has(word), word);
    }
    assert.deepEqual(bindSpokenPlace('saa kumi na mbili jioni', { fuzzy: true }), []);
    assert.deepEqual(bindSpokenPlace('saa sita usiku', { fuzzy: true }), []);
  });

  it('real places still bind', () => {
    assert.deepEqual(bindSpokenPlace('niko Kisumu, nitakuja Kitengela kesho'), ['kisumu', 'kitengela']);
    assert.deepEqual(bindSpokenPlace('na kuru'), ['nakuru']);
    assert.deepEqual(bindSpokenPlace('Ongata Rongai'), ['ongata rongai']);
    assert.deepEqual(bindSpokenPlace('Ronga', { fuzzy: true }), ['rongai']);
  });

  it('t16/t17: the hours answer on file is spoken, not replaced by "Okay."', () => {
    const t16 = guard(T16_MODEL, T16_CALLER);
    assert.equal(t16.text, T16_MODEL);
    assert.deepEqual(t16.dropReasons, []);
    const t17 = guard(T17_MODEL, T17_CALLER);
    assert.equal(t17.text, T17_MODEL);
    assert.deepEqual(t17.dropReasons, []);
  });

  it('hours on file still do not authorize a visit clock or other hours (#489)', () => {
    const visit = guard('We can come at 8 AM tomorrow.', 'Can you come tomorrow?');
    assert.doesNotMatch(visit.text, /8 AM/);
    assert.ok(visit.dropReasons.includes('unsaid_number'));
    const wrong = guard('We are open from 7 AM to 9 PM.', T17_CALLER);
    assert.doesNotMatch(wrong.text, /7 AM|9 PM/);
    assert.match(wrong.text, /6 PM/);
  });

  it('the local hours answer hears "operate until what time" and its variants', () => {
    for (const text of [
      T16_CALLER,
      T17_CALLER,
      'Are you open until what time?',
      'Do you work till what time?',
      'Until what time do you operate?',
      'What time do you guys close?',
      'What are your working hours?',
      'How late are you open?',
      'Mnafanya kazi mpaka saa ngapi?',
    ]) {
      assert.equal(looksLikeHoursAsk(text), true, text);
      assert.match(hoursAskLine(text, PROFILE, 'en'), /6 PM/, text);
    }
    for (const text of [
      'Can you come until what time?',
      'What time can you come?',
      'Mtafika saa ngapi?',
      'I work until what time?',
      'at 9.',
    ]) {
      assert.equal(looksLikeHoursAsk(text), false, text);
    }
  });
});

describe('2. A successful escalate closes the handoff', () => {
  const caps = { escalate: true, endCall: false };
  function run(turns) {
    let state = brain.createBrainState(PROFILE);
    const out = [];
    for (const [text, results] of turns) {
      state = brain.observeCallerTurn(state, { text, profile: PROFILE });
      const decision = determineNextBestAction({ state, capabilities: caps });
      state = brain.setNextBestAction(state, decision);
      if (results) state = brain.recordActionResults(state, results);
      out.push({ text, action: decision.action, intent: state.intent, handoff: state.handoff });
    }
    return out;
  }
  const named = [{ action: 'save_caller_info', status: 'succeeded', name: 'Alvin' }];
  const escalated = [{ action: 'escalate', status: 'succeeded', fingerprint: 'esc-ee81' }];

  it('t4 escalates once; t6-t12 answer the caller instead of escalating again', () => {
    const rows = run([
      ["Yeah, you're talking to Alvin.", named],
      ['Uh, can I speak to your boss?', escalated],
      ['Or do you— Or do you guys like cover kisu.'],
      ['Can you repeat to me the place.'],
      ['And do you guys like clean windows?'],
      ['Mpaka carpet?'],
      ['Carpet mnadhanioshea?'],
    ]);
    assert.equal(rows[1].action, 'ESCALATE');
    for (const row of rows.slice(2)) {
      assert.notEqual(row.action, 'ESCALATE', row.text);
      assert.notEqual(row.intent, 'human', row.text);
      assert.equal(row.handoff.requested, false, row.text);
    }
  });

  it('asking for the boss again gets the callback answer, not a second escalate', () => {
    const rows = run([
      ["Yeah, you're talking to Alvin.", named],
      ['Uh, can I speak to your boss?', escalated],
      ['Can I speak to your boss again?'],
    ]);
    assert.equal(rows[2].action, 'ANSWER');
    assert.equal(rows[2].handoff.completed, true);
  });

  it('a failed escalate keeps the handoff open', () => {
    const rows = run([
      ["Yeah, you're talking to Alvin.", named],
      ['Uh, can I speak to your boss?', [{ action: 'escalate', status: 'failed' }]],
      ['Hello?'],
    ]);
    assert.notEqual(rows[1].handoff.completed, true);
    assert.equal(rows[2].handoff.requested, true);
  });
});

describe('3. Tool turns get the adaptive filler', () => {
  it('useFiller no longer excludes ESCALATE / CREATE_REQUEST turns', () => {
    const start = SERVER.indexOf('const useFiller =');
    const block = SERVER.slice(start, SERVER.indexOf(';', start));
    assert.ok(start > 0);
    assert.doesNotMatch(block, /needsImmediateProgress/);
    assert.match(block, /shouldSpeakThinkingAck\(clean\)/);
    // The action-progress line itself stays withheld.
    assert.match(SERVER, /withheld: \$\{progressLine\}/);
  });
});

describe('4. STT finals keep their word boundary', () => {
  it('joins the real HD_ee81 finals with a space', () => {
    const cases = [
      [[' Or do you guys like cover', ' kisu.'], 'Or do you guys like cover kisu.'],
      [[' Can you repeat to me', ' the place.'], 'Can you repeat to me the place.'],
      [[' And', ' una.'], 'And una.'],
      [[' Uh,', ' at 9.'], 'Uh, at 9.'],
    ];
    for (const [finals, expected] of cases) {
      const parts = [];
      for (const final of finals) appendFinalPart(parts, final);
      assert.equal(joinUtteranceParts(parts), expected);
    }
  });

  it('a final with no leading space continues the previous word', () => {
    const parts = [];
    appendFinalPart(parts, ' Kiteng');
    appendFinalPart(parts, 'ela kesho.');
    assert.equal(joinUtteranceParts(parts), 'Kitengela kesho.');
  });

  it('server.js uses the helper at every join and final push', () => {
    assert.doesNotMatch(SERVER, /utteranceParts\.join\(''\)/);
    assert.equal((SERVER.match(/joinUtteranceParts\(utteranceParts\)/g) || []).length, 2);
    assert.equal((SERVER.match(/appendFinalPart\(utteranceParts, evt\.text\)/g) || []).length, 2);
  });
});

describe('5. A booking confirmed during a barge-in is still told', () => {
  it('queues once and is taken once', () => {
    const state = { conversation: {} };
    assert.equal(queueToolOutcome(state, '  Booked: Carpet Cleaning, tomorrow at 9 AM. '), 'Booked: Carpet Cleaning, tomorrow at 9 AM.');
    assert.equal(takeToolOutcome(state), 'Booked: Carpet Cleaning, tomorrow at 9 AM.');
    assert.equal(takeToolOutcome(state), '');
    assert.equal(queueToolOutcome(state, ''), '');
    assert.equal(queueToolOutcome(null, 'x'), '');
  });

  it('server keeps the barged confirmation and speaks it on the next turn', () => {
    assert.equal((SERVER.match(/const bargedActionConfirmation = heldTools\.toolHoldCancelled/g) || []).length, 2);
    const discards = SERVER.match(
      /queueToolOutcome\(callBrainStates\.get\(callKey\), result\?\.actionConfirmation \|\| result\?\.bargedActionConfirmation\)/g
    );
    assert.equal((discards || []).length, 4);
    const owed = SERVER.indexOf('const owedOutcome = takeToolOutcome(brainState);');
    assert.ok(owed > 0 && owed < SERVER.indexOf('const localReply = resolveLocalReply({'));
  });
});

describe('6. A Gemini coverage answer ends on a next step', () => {
  const T6_SPOKEN = 'We currently cover Nairobi, Kitengela, Kiambu, Juja, Ongata Rongai, and Syokimau.';
  const T8_SPOKEN = 'We cover Nairobi, Kitengela, Kiambu, Juja, Ongata Rongai, and Syokimau.';

  it('t6 and t8 get the question', () => {
    for (const spoken of [T6_SPOKEN, T8_SPOKEN]) {
      assert.equal(coverageAnswerWithoutNextStep(spoken), true);
      assert.match(coverageNextStepFor(spoken, { profile: PROFILE, language: 'en', state: {} }), /\?$/);
    }
    assert.equal(
      coverageNextStepFor('Tunafika Nairobi na Kitengela.', { profile: PROFILE, language: 'sw', state: {} }),
      'Ungependa huduma gani?'
    );
  });

  it('no question when one is already asked, off a shop, or off a non-coverage line', () => {
    assert.equal(coverageNextStepFor(`${T8_SPOKEN} When should we come?`, { profile: PROFILE }), '');
    assert.equal(coverageNextStepFor(T8_SPOKEN, { profile: { vertical: 'retail' } }), '');
    assert.equal(
      coverageNextStepFor('Yes, we offer interior window cleaning at two hundred shillings per window.', {
        profile: PROFILE,
      }),
      ''
    );
  });

  it('an outside-coverage answer offers the note', () => {
    assert.equal(
      coverageNextStepFor('Kisii is outside our coverage area.', { profile: PROFILE, language: 'en' }),
      'Should I note it for the team?'
    );
  });

  it('server speaks it at the end of a model turn', () => {
    assert.match(SERVER, /coverageNextStepFor\(\s*spokenChunks\.join/);
  });
});

describe('HD_ee813bcf6248 replay', () => {
  it('t6/t8 end on a question, t16/t17 keep the hours, and the score does not fall', async () => {
    const replay = await replayCall(FIXTURE, { mode: 'recorded' });
    const spoken = (n) =>
      replay.turns[n - 1].stages.filter((row) => row.stage === 'tts').map((row) => row.text).join(' ');
    const asked = (n) =>
      replay.turns[n - 1].stages.some((row) => row.stage === 'transform' && row.name === 'coverage_next_step');
    assert.ok(asked(6) && asked(8));
    assert.match(spoken(6), /Which service would you like\??$/);
    assert.match(spoken(8), /Which service would you like\??$/);
    assert.match(spoken(16), /saa mbili asubuhi/);
    assert.match(spoken(17), /saa mbili asubuhi/);
    const score = scoreFixtureReplay(replay, FIXTURE).score;
    assert.ok(score >= 82.5, `HD_ee813bcf6248 replay ${score}`);
  });
});
