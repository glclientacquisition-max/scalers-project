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
