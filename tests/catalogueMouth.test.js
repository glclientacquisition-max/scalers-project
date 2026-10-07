const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocalReply, planCallerModelTurn } = require('../src/conversation/turnPolicy');
const {
  createBrainState,
  observeCallerTurn,
  setNextBestAction,
  formatBrainStateForPrompt,
} = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { polishSpokenReply } = require('../src/conversation/dynamicSpeech');
const { looksLikeOfferAsk, looksLikeServiceDetailAsk } = require('../src/conversation/fileRead');
const { groundCatalogueSpeech } = require('../src/conversation/catalogueMouth');

const ITEMS = [
  { name: 'Couch cleaning' },
  { name: 'Mattress cleaning' },
  { name: 'Carpet cleaning' },
  { name: 'General cleaning (houses & air bnbs)' },
];

const PROFILE = {
  vertical: 'home_services',
  servicesCatalog: ITEMS,
  callerMemory: {
    name: 'Alvin',
    fileOwnerName: 'Alvin',
    sharedLine: false,
  },
};

function brainFor(text, extra = {}) {
  let brain = createBrainState({ ...PROFILE, ...extra });
  brain = observeCallerTurn(brain, {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
    profile: { ...PROFILE, ...extra },
  });
  return brain;
}

describe('catalogue mouth flag', () => {
  const previous = process.env.BRAIN_GEMINI_CATALOGUE;

  afterEach(() => {
    if (previous == null) delete process.env.BRAIN_GEMINI_CATALOGUE;
    else process.env.BRAIN_GEMINI_CATALOGUE = previous;
  });

  it('keeps the local file list when the flag is off', () => {
    delete process.env.BRAIN_GEMINI_CATALOGUE;
    const state = brainFor('Which services do you offer?');
    const local = resolveLocalReply({
      text: 'Which services do you offer?',
      state,
      language: 'en',
      profile: PROFILE,
    });
    assert.equal(local.outcome, 'catalogue');
    assert.match(local.line, /Couch cleaning/);
    assert.match(local.line, /General cleaning/);
    assert.doesNotMatch(local.line, /houses|air bnbs/);
    const gate = planCallerModelTurn(state);
    assert.equal(gate.runModel, false);
    assert.match(formatBrainStateForPrompt(state), /^((?!CATALOGUE MOUTH).)*$/s);
  });

  it('lets Gemini run on the first services ask when the flag is on', () => {
    process.env.BRAIN_GEMINI_CATALOGUE = 'on';
    const state = brainFor('Which services do you offer?');
    const local = resolveLocalReply({
      text: 'Which services do you offer?',
      state,
      language: 'en',
      profile: PROFILE,
    });
    assert.equal(local, null);
    const gate = planCallerModelTurn(state);
    assert.equal(gate.runModel, true);
    assert.equal(gate.line, '');
    const decision = determineNextBestAction({ state });
    assert.equal(decision.action, 'ANSWER');
    assert.match(decision.reason, /Couch cleaning/);
    assert.match(decision.reason, /Mattress cleaning/);
    assert.match(decision.reason, /Carpet cleaning/);
    assert.match(decision.reason, /General cleaning/);
    assert.doesNotMatch(decision.reason, /houses|air bnbs|Window/);
    const prompted = setNextBestAction(state, decision);
    const block = formatBrainStateForPrompt(prompted);
    assert.match(block, /CATALOGUE MOUTH/);
    assert.match(block, /"Couch cleaning"/);
    assert.match(block, /"General cleaning"/);
    assert.doesNotMatch(block, /houses & air bnbs/);
  });
});

describe('catalogue grounding and no re-list', () => {
  it('keeps a warm Gemini line whose names are exact items', () => {
    const spoken = polishSpokenReply(
      'Sure. We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning. Which one do you need?',
      {
        state: brainFor('Which services do you offer?'),
        callerTurns: ['Which services do you offer?'],
        profile: PROFILE,
        language: 'en',
      }
    );
    assert.match(spoken, /^Sure\./);
    assert.match(spoken, /Couch cleaning/);
    assert.match(spoken, /Mattress cleaning/);
    assert.match(spoken, /Carpet cleaning/);
    assert.match(spoken, /General cleaning/);
    assert.match(spoken, /Which one do you need/);
    const opener = polishSpokenReply('Sure.', {
      state: brainFor('Which services do you offer?'),
      callerTurns: ['Which services do you offer?'],
      profile: PROFILE,
      language: 'en',
    });
    assert.equal(opener, 'Sure.');
  });

  it('drops an invented service and keeps the exact names', () => {
    const spoken = polishSpokenReply(
      'Sure. We offer Couch cleaning, Window washing, and Carpet cleaning.',
      {
        state: brainFor('What services do you offer?'),
        callerTurns: ['What services do you offer?'],
        profile: PROFILE,
        language: 'en',
      }
    );
    assert.match(spoken, /Sure/);
    assert.match(spoken, /Couch cleaning/);
    assert.match(spoken, /Carpet cleaning/);
    assert.doesNotMatch(spoken, /Window washing/);
    const names = ['Couch cleaning', 'Mattress cleaning', 'Carpet cleaning', 'General cleaning'];
    for (const piece of spoken.split(/,| and /)) {
      const hit = names.filter((name) => piece.includes(name));
      assert.ok(hit.length <= 1);
    }
  });

  it('replaces a paraphrase with the file names', () => {
    const spoken = polishSpokenReply('We clean sofas, rugs, and the whole house.', {
      state: brainFor('Which services do you offer?'),
      callerTurns: ['Which services do you offer?'],
      profile: PROFILE,
      language: 'en',
    });
    assert.match(spoken, /Couch cleaning/);
    assert.match(spoken, /Carpet cleaning/);
    assert.doesNotMatch(spoken, /sofas|rugs|whole house/);
  });

  it('answers a detail ask with facts, not the name list', () => {
    assert.equal(looksLikeServiceDetailAsk('Tell me details about the services'), true);
    assert.equal(looksLikeOfferAsk('Tell me details about the services'), false);
    assert.equal(looksLikeOfferAsk('Which services do you offer?'), true);
    const profile = {
      ...PROFILE,
      servicesCatalog: [
        { name: 'Couch cleaning', price_range: '1500 to 2000' },
        { name: 'Mattress cleaning', notes: 'both sides' },
        { name: 'Carpet cleaning' },
        { name: 'General cleaning' },
      ],
    };
    const state = brainFor('Tell me details about the services', profile);
    const decision = determineNextBestAction({ state });
    assert.match(decision.reason, /do not read the full catalogue/i);
    const local = resolveLocalReply({
      text: 'Tell me details about the services',
      state,
      language: 'en',
      profile,
    });
    assert.equal(local.outcome, 'service_facts');
    assert.match(local.line, /Couch cleaning is 1500 to 2000/);
    assert.match(local.line, /Mattress cleaning: both sides/);
    assert.doesNotMatch(local.line, /Carpet cleaning/);
    assert.doesNotMatch(local.line, /General cleaning/);
    const relist = polishSpokenReply(
      'We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning.',
      {
        state,
        callerTurns: ['Tell me details about the services'],
        profile,
        language: 'en',
      }
    );
    assert.match(relist, /1500 to 2000/);
    assert.doesNotMatch(relist, /Carpet cleaning/);
    assert.doesNotMatch(relist, /We offer Couch cleaning, Mattress cleaning, Carpet cleaning/);
  });

  it('after name yes continues and does not re-list', () => {
    let state = brainFor('Which services do you offer?');
    state = setNextBestAction(state, determineNextBestAction({ state }));
    state = observeCallerTurn(state, {
      text: 'Yes.',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile: PROFILE,
      lastAgentText: 'Am I speaking with Alvin?',
    });
    assert.equal(state.caller.nameJustConfirmed, true);
    const decision = determineNextBestAction({ state });
    assert.equal(decision.action, 'ANSWER');
    assert.notEqual(decision.action, 'END');
    assert.doesNotMatch(decision.reason, /Speak that list|Speak only these names/i);
    const local = resolveLocalReply({
      text: 'Yes.',
      state,
      profile: PROFILE,
      language: 'en',
    });
    assert.notEqual(local && local.outcome, 'catalogue');
    const spoken = polishSpokenReply(
      'We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning.',
      {
        state,
        callerTurns: ['Yes.'],
        profile: PROFILE,
        language: 'en',
      }
    );
    assert.equal(spoken, 'Which service do you need?');
    const bye = determineNextBestAction({
      state: observeCallerTurn(state, {
        text: 'Kwaheri',
        detectedLanguage: 'en',
        resolvedLanguage: 'en',
        profile: PROFILE,
      }),
    });
    assert.equal(bye.action, 'END');
  });

  it('grounds a list without calling the model wrapper', () => {
    const grounded = groundCatalogueSpeech(
      'We offer Couch cleaning, Window washing, and Carpet cleaning.',
      ['Couch cleaning', 'Carpet cleaning', 'Mattress cleaning'],
      { listTurn: true }
    );
    assert.match(grounded, /Couch cleaning/);
    assert.match(grounded, /Carpet cleaning/);
    assert.doesNotMatch(grounded, /Window/);
  });
});
