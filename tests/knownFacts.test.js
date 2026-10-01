const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');

const OPEN = new Date('2026-10-01T10:00:00.000Z');

function state(text) {
  return observeCallerTurn(createBrainState({ vertical: 'home_services' }), {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
  });
}

describe('known facts stay off Gemini', () => {
  it('lists the catalogue for a services ask', () => {
    const local = resolveLocalReply({
      text: 'Which services do you offer?',
      state: state('Which services do you offer?'),
      language: 'en',
      profile: {
        servicesCatalog: [{ name: 'Couch cleaning' }, { name: 'Carpet cleaning' }],
      },
    });
    assert.equal(local.outcome, 'catalogue');
    assert.match(local.line, /Couch cleaning and Carpet cleaning/);
    assert.doesNotMatch(local.line, /shilling|price/i);
  });

  it('does not steal a real booking', () => {
    const local = resolveLocalReply({
      text: 'I want to book carpet cleaning tomorrow.',
      state: state('I want to book carpet cleaning tomorrow.'),
      language: 'en',
      profile: {
        servicesCatalog: [{ name: 'Carpet cleaning' }],
        hoursSchedule: defaultHoursSchedule(),
      },
    });
    assert.equal(local, null);
  });

  it('says the open window from the schedule', () => {
    const local = resolveLocalReply({
      text: 'Are you open?',
      state: state('Are you open?'),
      language: 'en',
      profile: { hoursSchedule: defaultHoursSchedule() },
      // hoursAskLine uses new Date() unless we pass now. The helper uses new Date().
    });
    assert.equal(local && local.outcome, 'hours_ask');
    assert.match(local.line, /open|closed/i);
  });
});
