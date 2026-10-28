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

  // B2: the old Gemini media turn (local reply, catalogue mouth, committed speech, Gemini stream) is deleted; every
  // media turn is the owned v2 turn, which speaks through the engines with skipFileGate.
  it('B2: the media turn has no old catalogue mouth / local reply / Gemini stream left; v2 owns the turn', () => {
    for (const re of [/speakText\(localReply\.line\)/, /speakText\(paceLine\)/, /speakText\(replayLine/, /I don't have a booking for you/, /sentenceBreaks/, /renderSpokenList/, /catalogue spoken/,
      /resolveLocalReply\(\{/, /planCatalogueMouth\(\{/, /planCommittedSpeech\(\{/, /const streamOn/, /runGeminiTurn/, /pendingPriceAfterNameYes/]) assert.doesNotMatch(turn, re);
    assert.match(turn, /v2OwnsCall\.runOwnedTurn\(/);
    assert.match(turn, /skipFileGate: true/);
    assert.doesNotMatch(serverSource, /fillerUsedThisCall/);
  });

  it('prepares catalogue and hours lines without treating them as a file read', () => {
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
    // B2: the old turn's progress line (needsImmediateProgress) is deleted with it
    assert.doesNotMatch(turn, /speakText\(progressLine\)/);
    assert.doesNotMatch(turn, /const needsImmediateProgress/);
  });

  it('leaves greeting, outage, and empty-speech recovery in place', () => {
    assert.match(serverSource, /async function speakGreetingSentences/);
    assert.match(serverSource, /function handleSpeechProviderOutage/);
    // B2: the empty-Gemini-speech recovery belonged to the deleted old turn; v2's repair template covers an empty turn
    assert.doesNotMatch(serverSource, /planEmptyGeminiSpeech\(\{/);
    assert.match(serverSource, /v2OwnsCall\.repairLine\(/);
  });
});

describe('visit lookup speaks the code sentence on the stream', () => {
  const turn = runCallerTurnSource();

  it('formatNameConfirmSpeech still formats the open file (the old turn that streamed it is gone, B2)', () => {
    // B2: the old turn's visit-lookup sentence path is deleted; v2 reads the caller file (lookup_caller receipt)
    assert.doesNotMatch(turn, /if \(suppressModelSpeech\) return;|spokeLookupSentence && confirmation === lookupSpoken/);
    assert.doesNotMatch(turn, /speakText\(sentence\)/);

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
