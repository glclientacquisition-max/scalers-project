// Mid-call speech stays on the Soniox sentence stream.
// Run: node --test tests/voiceSentenceStream.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { looksLikePaceOnlyTurn } = require('../src/conversation/dynamicSpeech');
const {
  formatNameConfirmSpeech,
  openLineHoldDecision,
} = require('../src/conversation/openLineSpeech');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function callerState(text) {
  return observeCallerTurn(createBrainState({ vertical: 'home_services' }), {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
  });
}

function runCallerTurnSource() {
  const start = serverSource.indexOf('async function runCallerTurn');
  const end = serverSource.indexOf('function flushUtterance', start);
  assert.ok(start > 0 && end > start);
  return serverSource.slice(start, end);
}

describe('mid-call one-shots do not speak-and-return', () => {
  const turn = runCallerTurnSource();

  it('does not speak a catalogue, hours, pace, or replay line and return', () => {
    assert.doesNotMatch(turn, /speakText\(localReply\.line\)/);
    assert.doesNotMatch(turn, /speakText\(paceLine\)/);
    assert.doesNotMatch(turn, /speakText\(replayLine/);
    assert.doesNotMatch(turn, /I don't have a booking for you/);
    assert.match(turn, /local line not spoken/);
    assert.match(turn, /pace-only stays on sentence stream/);
    assert.match(turn, /resolveLocalReply\(\{/);
  });

  it('keeps catalogue and hours lines off the early return', () => {
    const profile = {
      servicesCatalog: [{ name: 'Couch cleaning' }, { name: 'Carpet cleaning' }],
      hoursSchedule: defaultHoursSchedule(),
    };
    const catalogue = resolveLocalReply({
      text: 'Which services do you offer?',
      state: callerState('Which services do you offer?'),
      language: 'en',
      profile,
    });
    const hours = resolveLocalReply({
      text: 'Are you open?',
      state: callerState('Are you open?'),
      language: 'en',
      profile,
    });
    assert.equal(catalogue.outcome, 'catalogue');
    assert.equal(hours.outcome, 'hours_ask');
    assert.notEqual(catalogue.outcome, 'file_read');
    assert.notEqual(hours.outcome, 'file_read');
    assert.equal(looksLikePaceOnlyTurn('slower'), true);
    assert.equal(
      resolveLocalReply({
        text: 'slower',
        state: callerState('slower'),
        language: 'en',
        profile,
      }),
      null
    );
    // Those outcomes are not the lookup exception, so the model keeps the stream.
    assert.doesNotMatch(turn, /speakText\(progressLine\)/);
    assert.match(turn, /const needsImmediateProgress = actionMayExecute;/);
    assert.doesNotMatch(turn, /needsImmediateProgress = actionMayExecute \|\| handoffNameAsk/);
  });

  it('leaves greeting, outage, and empty-speech recovery in place', () => {
    assert.match(serverSource, /isGreeting:\s*true/);
    assert.match(serverSource, /function handleSpeechProviderOutage/);
    assert.match(serverSource, /planEmptyGeminiSpeech\(\{/);
    assert.match(serverSource, /Sorry, say that again\?|planned\.line/);
  });
});

describe('visit lookup speaks the code sentence on the stream', () => {
  const turn = runCallerTurnSource();

  it('pushes formatNameConfirmSpeech through the session and drops model text', () => {
    assert.match(turn, /if \(suppressModelSpeech\) return;/);
    assert.match(turn, /session\.pushText\(sentence\)/);
    assert.match(turn, /await session\.end\(\)/);
    assert.match(turn, /nameConfirmSpeech\(callKey\)/);
    assert.match(turn, /localReply\?\.outcome === 'file_read'/);
    assert.doesNotMatch(turn, /speakText\(sentence\)/);
    assert.match(turn, /spokeLookupSentence && confirmation === lookupSpoken/);

    const hold = openLineHoldDecision({
      nameConfirmed: true,
      nameJustConfirmed: false,
      callerText: 'What are my bookings?',
    });
    assert.equal(hold.holdVisitLookup, true);
    assert.equal(hold.holdSpeech, true);
    const sentence = formatNameConfirmSpeech({
      language: 'en',
      openVisits: ['Carpet cleaning | tomorrow 12:00 PM | requested | Westlands'],
      openRequests: ['request | Sofa | Friday | confirmed'],
    });
    assert.match(sentence, /You have Carpet cleaning, tomorrow 12:00 PM, Westlands\./);
    assert.match(sentence, /You have a Sofa request, Friday\./);
    assert.match(sentence, /Nothing is still open\.|What would you like to do\?/);
    assert.doesNotMatch(sentence, /I don't have a booking for you/);
    const empty = formatNameConfirmSpeech({ language: 'en', openVisits: [], openRequests: [] });
    assert.equal(empty, 'Nothing is still open. What would you like to do?');
  });

  it('does not treat hours or a new booking as the lookup hold', () => {
    assert.equal(
      openLineHoldDecision({
        nameConfirmed: true,
        callerText: 'which services do you offer',
      }).holdSpeech,
      false
    );
    assert.equal(
      openLineHoldDecision({
        nameConfirmed: true,
        callerText: 'book a carpet clean for tomorrow',
      }).holdSpeech,
      false
    );
  });
});
