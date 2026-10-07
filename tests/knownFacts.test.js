const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');
const { createBrainState, observeCallerTurn, setNextBestAction } = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { polishSpokenReply } = require('../src/conversation/dynamicSpeech');
const { looksLikeOfferAsk } = require('../src/conversation/fileRead');

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

const CHAPTER_ONE = {
  vertical: 'home_services',
  servicesCatalog: [
    { name: 'Couch cleaning' },
    { name: 'Mattress cleaning' },
    { name: 'Carpet cleaning' },
    { name: 'General cleaning' },
  ],
  callerMemory: {
    name: 'Alvin',
    fileOwnerName: 'Alvin',
    sharedLine: true,
  },
};

describe('HD_ec64018de793 catalogue list', () => {
  it('treats a services-list ask as the catalogue, in English or a mix', () => {
    assert.equal(looksLikeOfferAsk('Tell me your services, man.'), true);
    assert.equal(looksLikeOfferAsk('Niambie huduma zenu.'), true);
    assert.equal(
      looksLikeOfferAsk('Ah, nilikuwa nataka, like, to know which services do you do over'),
      true
    );
    const listed = resolveLocalReply({
      text: 'Tell me your services, man.',
      state: state('Tell me your services, man.'),
      language: 'en',
      profile: CHAPTER_ONE,
    });
    assert.equal(listed.outcome, 'catalogue');
    assert.match(
      listed.line,
      /^We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning/
    );
    assert.doesNotMatch(listed.line, /what do you need done|which service would you like|ungependa/i);
  });

  it('answers the pending services ask after name-confirm yes, and drops location over', () => {
    let brain = createBrainState(CHAPTER_ONE);
    brain = observeCallerTurn(brain, {
      text: 'Ah, nilikuwa nataka, like, to know which services do you do over',
      detectedLanguage: 'sw',
      resolvedLanguage: 'sw',
      profile: CHAPTER_ONE,
    });
    assert.equal(brain.entities.location, undefined);
    assert.match(brain.goal.description, /services/i);

    brain = observeCallerTurn(brain, {
      text: 'Yes.',
      detectedLanguage: 'sw',
      resolvedLanguage: 'sw',
      profile: CHAPTER_ONE,
      lastAgentText: 'Je, naongea na Alvin?',
    });
    assert.equal(brain.caller.nameConfirmed, true);
    assert.equal(brain.caller.boundRole, 'primary');
    const local = resolveLocalReply({
      text: 'Yes.',
      state: brain,
      profile: CHAPTER_ONE,
      language: 'sw',
    });
    assert.equal(local.outcome, 'catalogue');
    assert.match(local.line, /^Tuna Couch cleaning/);
    assert.match(local.line, /Mattress cleaning/);
    assert.match(local.line, /Carpet cleaning/);
    assert.match(local.line, /General cleaning/);
    assert.doesNotMatch(local.line, /ungependa|what do you need|which service would you like/i);

    const decision = determineNextBestAction({ state: brain });
    assert.equal(decision.action, 'ANSWER');
    assert.equal(decision.resolves, true);
    assert.match(decision.reason, /catalogue/i);
    const resolved = setNextBestAction(brain, decision);
    assert.equal(resolved.resolution.status, 'resolved');

    const spoken = polishSpokenReply('Ungependa tusaidie na gani leo?', {
      state: brain,
      callerTurns: ['Yes.'],
      profile: CHAPTER_ONE,
      language: 'sw',
    });
    assert.match(spoken, /^Tuna Couch cleaning/);
    assert.doesNotMatch(spoken, /ungependa|gani leo/i);

    const crystal = polishSpokenReply('What do you need done? Which service would you like?', {
      state: state('Tell me your services, man.'),
      callerTurns: ['Tell me your services, man.'],
      profile: CHAPTER_ONE,
      language: 'en',
    });
    assert.match(crystal, /^We offer Couch cleaning/);
    assert.doesNotMatch(crystal, /what do you need done|which service would you like/i);
  });
});
