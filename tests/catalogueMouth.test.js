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
const { buildSystemPrompt } = require('../src/prompts');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');

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
    assert.match(block, /Exact service names/);
    assert.doesNotMatch(block, /CATALOGUE MOUTH/);
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

  it('treats a singular offer ask as the file list', () => {
    assert.equal(looksLikeOfferAsk('which service is you offer'), true);
    assert.equal(looksLikeOfferAsk('which service do you offer'), true);
    assert.equal(looksLikeOfferAsk('which service would you like'), false);
    const state = brainFor('which service is you offer.');
    const local = resolveLocalReply({
      text: 'which service is you offer.',
      state,
      profile: PROFILE,
      language: 'en',
    });
    assert.equal(local.outcome, 'catalogue');
    assert.match(local.line, /Carpet cleaning/);
    assert.doesNotMatch(formatBrainStateForPrompt(state), /CATALOGUE MOUTH/);
    assert.doesNotMatch(buildSystemPrompt({ vertical: 'home_services' }), /CATALOGUE MOUTH/);
  });

  it('speaks the on-file price for the confirmed service', () => {
    const profile = {
      ...PROFILE,
      servicesCatalog: [
        { name: 'Couch cleaning', price_range: '800-1200' },
        { name: 'Carpet cleaning', price_range: 'Ksh 1500-2000', notes: 'per room' },
        { name: 'Sofa cleaning' },
      ],
    };
    let state = createBrainState(profile);
    state = observeCallerTurn(state, {
      text: 'Carpet cleaning',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
      entities: extractConversationEntities('Carpet cleaning', { profile, state }),
    });
    state = observeCallerTurn(state, {
      text: 'How much is it?',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
      entities: extractConversationEntities('How much is it?', { profile, state }),
    });
    const local = resolveLocalReply({
      text: 'How much is it?',
      state,
      profile,
      language: 'en',
    });
    assert.equal(local.outcome, 'price');
    assert.equal(local.line, 'Carpet cleaning is Ksh 1500-2000.');
    const spoken = polishSpokenReply(
      "I don't have that on file. I can note it for the team.",
      {
        state,
        callerTurns: ['How much is it?'],
        profile,
        language: 'en',
      }
    );
    assert.equal(spoken, 'Carpet cleaning is Ksh 1500-2000.');
    assert.doesNotMatch(spoken, /on file/i);
    const swState = observeCallerTurn(state, {
      text: 'Ni pesa ngapi?',
      detectedLanguage: 'sw',
      resolvedLanguage: 'sw',
      profile,
    });
    const sw = polishSpokenReply('Sina hiyo kwenye rekodi. Naweza kuandika kwa timu.', {
      state: swState,
      callerTurns: ['Ni pesa ngapi?'],
      profile,
      language: 'sw',
    });
    assert.equal(sw, 'Carpet cleaning ni Ksh 1500-2000.');
    const missing = resolveLocalReply({
      text: 'How much is sofa cleaning?',
      state,
      profile,
      language: 'en',
    });
    assert.equal(missing, null);
    const honest = polishSpokenReply("I don't have that on file. I can note it for the team.", {
      state,
      callerTurns: ['How much is sofa cleaning?'],
      profile,
      language: 'en',
    });
    assert.match(honest, /don't have that on file/i);
    assert.doesNotMatch(honest, /1500/);
  });

  it('speaks the carpet note or price on a more-about ask', () => {
    const profile = {
      ...PROFILE,
      servicesCatalog: [
        { name: 'Carpet cleaning', price_range: 'Ksh 1500-2000' },
        { name: 'Mattress cleaning', notes: 'both sides' },
      ],
    };
    const state = brainFor('tell me more about carpet', profile);
    const local = resolveLocalReply({
      text: 'tell me more about carpet',
      state,
      profile,
      language: 'en',
    });
    assert.equal(local.outcome, 'service_facts');
    assert.equal(local.line, 'Carpet cleaning is Ksh 1500-2000.');
    const booked = polishSpokenReply('Would you like to book a cleaning visit for your carpet?', {
      state,
      callerTurns: ['tell me more about carpet'],
      profile,
      language: 'en',
    });
    assert.match(booked, /Carpet cleaning is Ksh 1500-2000/);
    assert.doesNotMatch(booked, /don't have that on file/i);
  });

  it('drops a Gemini catalogue label after name yes', () => {
    let state = brainFor('which service is you offer.');
    state = setNextBestAction(state, determineNextBestAction({ state }));
    state = observeCallerTurn(state, {
      text: 'Yes.',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile: PROFILE,
      lastAgentText: 'Am I speaking with Alvin?',
    });
    const local = resolveLocalReply({
      text: 'Yes.',
      state,
      profile: PROFILE,
      language: 'en',
    });
    assert.notEqual(local && local.outcome, 'catalogue');
    const spoken = polishSpokenReply(
      'CATALOGUE MOUTH: We offer couch cleaning, mattress cleaning, carpet cleaning, general cleaning for houses and Airbnbs, and pet stain removal.',
      {
        state,
        callerTurns: ['Yes.'],
        profile: PROFILE,
        language: 'en',
      }
    );
    assert.equal(spoken, 'Which service do you need?');
    assert.doesNotMatch(spoken, /CATALOGUE MOUTH/i);
    assert.doesNotMatch(spoken, /couch cleaning/i);
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
