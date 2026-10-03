const test = require('node:test');
const assert = require('node:assert/strict');
const { formatNameConfirmSpeech } = require('../src/conversation/openLineSpeech');

test('speaks every open line and skips a missing place', () => {
  const said = formatNameConfirmSpeech({
    language: 'en',
    openVisits: [
      'Carpet cleaning | tomorrow 12:00 PM | requested | Westlands',
      'Carpet cleaning and Pet stain removal | tomorrow 10:00 AM | open',
    ],
    openRequests: [],
  });
  assert.match(said, /You have Carpet cleaning, tomorrow 12:00 PM, Westlands\./);
  assert.match(said, /You have Carpet cleaning and Pet stain removal, tomorrow 10:00 AM\./);
  assert.match(said, /What would you like to do\?$/);
  assert.doesNotMatch(said, /no booking/i);
  assert.doesNotMatch(said, /nothing on file/i);
  const second = said.split('. ')[1] || '';
  assert.doesNotMatch(second, /Westlands/);
});

test('nothing open does not teach a denial', () => {
  const said = formatNameConfirmSpeech({ language: 'en', openVisits: [], openRequests: [] });
  assert.equal(said, 'Nothing is still open. What would you like to do?');
  assert.doesNotMatch(said, /no booking|I don't have a booking|no visit|nothing on file/i);
});

const { looksLikeOpenVisitLookup, openLineHoldDecision } = require('../src/conversation/openLineSpeech');

test('already-confirmed visit lookup matches only a file read', () => {
  for (const said of [
    'Inquire about my booking',
    'inquire about my bookings',
    'my bookings',
    'do I have a visit',
    'What are my bookings?',
  ]) {
    assert.equal(looksLikeOpenVisitLookup(said), true, said);
  }
  for (const said of [
    'book a carpet clean for tomorrow',
    'at what time do you open?',
    'what time do you open',
    'which services do you offer?',
    'cancel my visit',
    'change my booking',
    'move my visit to Friday',
  ]) {
    assert.equal(looksLikeOpenVisitLookup(said), false, said);
  }
});

test('visit lookup holds only when the name is already confirmed', () => {
  const lookup = openLineHoldDecision({
    nameConfirmed: true,
    nameJustConfirmed: false,
    callerText: 'Inquire about my bookings',
  });
  assert.equal(lookup.holdVisitLookup, true);
  assert.equal(lookup.holdSpeech, true);
  assert.equal(lookup.holdNameConfirm, false);

  const just = openLineHoldDecision({
    nameConfirmed: true,
    nameJustConfirmed: true,
    callerText: 'yes',
  });
  assert.equal(just.holdNameConfirm, true);
  assert.equal(just.holdVisitLookup, false);
  assert.equal(just.holdSpeech, true);

  const unbound = openLineHoldDecision({
    nameConfirmed: false,
    callerText: 'my bookings',
  });
  assert.equal(unbound.holdSpeech, false);

  const hours = openLineHoldDecision({
    nameConfirmed: true,
    callerText: 'which services do you offer',
  });
  assert.equal(hours.holdSpeech, false);
});
