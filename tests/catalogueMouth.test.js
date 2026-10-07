// Catalogue mouth: both staging listens are opt-in.
// Voice: VOICE_GEMINI_CATALOGUE. Brain: BRAIN_GEMINI_CATALOGUE.
// Default is the Phase-0 local line.
// Run: node --test tests/catalogueMouth.test.js

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocalReply, planCallerModelTurn } = require('../src/conversation/turnPolicy');
const { catalogueFileNames } = require('../src/conversation/knownFacts');
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
const { prepareForTts } = require('../src/speech/ttsNormalize');
const { linesBeforeNameAsk } = require('../src/speech/callerFileSpeech');
const {
  catalogueGeminiDirective,
  geminiCatalogueEnabled,
  planCatalogueMouth,
  softenCataloguePunctuation,
} = require('../src/speech/catalogueMouth');
const { buildSystemPrompt } = require('../src/prompts');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');

const FILE = {
  servicesCatalog: [
    { name: 'Couch cleaning', notes: 'includes cushions' },
    { name: 'Mattress cleaning' },
    { name: 'Carpet cleaning' },
    { name: 'General cleaning (houses & air bnbs)' },
    { name: 'Pet stain removal' },
  ],
};

function state(text) {
  return observeCallerTurn(createBrainState({ vertical: 'home_services' }), {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
  });
}

function catalogueReply(language) {
  return resolveLocalReply({
    text: language === 'en' ? 'Which services do you offer?' : 'Niambie huduma zenu.',
    state: state(language === 'en' ? 'Which services do you offer?' : 'Niambie huduma zenu.'),
    language,
    profile: FILE,
  });
}

describe('VOICE_GEMINI_CATALOGUE', () => {
  it('defaults the Gemini catalogue listen off', () => {
    assert.equal(geminiCatalogueEnabled({}), false);
    assert.equal(geminiCatalogueEnabled({ VOICE_GEMINI_CATALOGUE: '' }), false);
    assert.equal(geminiCatalogueEnabled({ VOICE_GEMINI_CATALOGUE: 'off' }), false);
    assert.equal(geminiCatalogueEnabled({ VOICE_GEMINI_CATALOGUE: 'on' }), true);
    assert.equal(geminiCatalogueEnabled({ VOICE_GEMINI_CATALOGUE: 'ON' }), true);
  });

  it('speaks the Phase-0 local line when the flag is off', () => {
    const local = catalogueReply('en');
    const mouth = planCatalogueMouth({
      localReply: local,
      reasoningDown: false,
      geminiCatalogue: false,
    });
    assert.equal(local.outcome, 'catalogue');
    assert.equal(mouth.speakLocal, true);
    assert.equal(mouth.letGemini, false);
    assert.equal(mouth.reason, 'flag_off');
    assert.equal(
      mouth.line,
      'We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning, and more. Which one do you need?'
    );
    assert.doesNotMatch(mouth.line, /Couch cleaning\. Mattress/);
  });

  it('speaks the Phase-0 line when the flag is on and does not let Gemini re-list', () => {
    const local = catalogueReply('en');
    const mouth = planCatalogueMouth({
      localReply: local,
      reasoningDown: false,
      geminiCatalogue: true,
    });
    assert.equal(mouth.speakLocal, true);
    assert.equal(mouth.letGemini, false);
    assert.equal(mouth.reason, 'local_blend');
    assert.equal(mouth.line, local.line);
    assert.doesNotMatch(mouth.line, /Couch cleaning\. Mattress/);
  });

  it('speaks the Phase-0 line when Brain withheld the local reply', () => {
    const mouth = planCatalogueMouth({
      localReply: null,
      text: 'Which services do you offer?',
      profile: FILE,
      language: 'en',
      reasoningDown: false,
      geminiCatalogue: true,
    });
    assert.equal(mouth.speakLocal, true);
    assert.equal(mouth.letGemini, false);
    assert.equal(mouth.reason, 'local_blend');
    assert.equal(
      mouth.line,
      'We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning, and more. Which one do you need?'
    );
  });

  it('does not speak the full list on a detail ask', () => {
    const detail = resolveLocalReply({
      text: 'More details on carpet cleaning',
      state: state('More details on carpet cleaning'),
      language: 'en',
      profile: FILE,
    });
    const mouth = planCatalogueMouth({
      localReply: detail,
      text: 'More details on carpet cleaning',
      profile: FILE,
      language: 'en',
      reasoningDown: false,
      geminiCatalogue: true,
    });
    assert.notEqual(detail && detail.outcome, 'catalogue');
    assert.equal(mouth.speakLocal, false);
    assert.equal(mouth.letGemini, false);
    assert.equal(mouth.line, '');
    const bare = planCatalogueMouth({
      localReply: null,
      text: 'More details on carpet cleaning',
      profile: FILE,
      language: 'en',
      geminiCatalogue: true,
    });
    assert.equal(bare.speakLocal, false);
    assert.equal(bare.line, '');
  });

  it('speaks Phase-0 for a clear services ask and for Yes while that list is still pending', () => {
    const ask = 'which service is you offer';
    const local = resolveLocalReply({
      text: ask,
      state: state(ask),
      language: 'en',
      profile: FILE,
    });
    assert.equal(local.outcome, 'catalogue');
    assert.match(local.line, /and General cleaning, and more/);
    assert.doesNotMatch(local.line, /Couch cleaning\. Mattress/);
    const pending = planCatalogueMouth({
      localReply: null,
      text: 'Yes.',
      profile: FILE,
      language: 'en',
      callerTurns: [ask, 'Yes.'],
      catalogueListed: false,
    });
    assert.equal(pending.speakLocal, true);
    assert.equal(pending.letGemini, false);
    assert.equal(pending.line, local.line);
    const listed = planCatalogueMouth({
      localReply: null,
      text: 'Yes.',
      profile: FILE,
      language: 'en',
      callerTurns: [ask, 'Yes.'],
      catalogueListed: true,
    });
    assert.equal(listed.speakLocal, false);
    assert.equal(listed.line, '');
  });

  it('speaks the Phase-0 local line on a reasoning outage even when the flag is on', () => {
    const local = catalogueReply('sw');
    const mouth = planCatalogueMouth({
      localReply: local,
      reasoningDown: true,
      geminiCatalogue: true,
    });
    assert.equal(mouth.speakLocal, true);
    assert.equal(mouth.letGemini, false);
    assert.equal(mouth.reason, 'outage');
    assert.equal(
      mouth.line,
      'Tuna Couch cleaning, Mattress cleaning, Carpet cleaning, na General cleaning, na zingine. Unahitaji gani?'
    );
    const prepared = prepareForTts(mouth.line, { callLanguage: 'sw' });
    assert.doesNotMatch(prepared.text, /\bna and\b/i);
    assert.doesNotMatch(prepared.text, /\bperiod\b/i);
    assert.match(prepared.text, /na General cleaning na zingine/);
    assert.doesNotMatch(prepared.text, /[.?]/);
  });

  it('does not steal an hours line', () => {
    const hours = resolveLocalReply({
      text: 'Are you open?',
      state: state('Are you open?'),
      language: 'en',
      profile: FILE,
    });
    const mouth = planCatalogueMouth({
      localReply: hours,
      reasoningDown: true,
      geminiCatalogue: false,
    });
    assert.equal(mouth.speakLocal, false);
    assert.equal(mouth.line, '');
  });
});

describe('catalogue file names', () => {
  it('uses the file and drops notes', () => {
    const file = catalogueFileNames(FILE);
    assert.deepEqual(file.names, [
      'Couch cleaning',
      'Mattress cleaning',
      'Carpet cleaning',
      'General cleaning',
    ]);
    assert.equal(file.more, true);
  });

  it('tells Gemini the file names and no others', () => {
    const local = catalogueReply('en');
    const note = catalogueGeminiDirective({ profile: FILE, localReply: local });
    assert.match(note, /Couch cleaning; Mattress cleaning; Carpet cleaning; General cleaning/);
    assert.match(note, /Do not add, rename, or drop one/);
    assert.match(note, /More are on file/);
    assert.doesNotMatch(note, /Pet stain|Window washing|cushions|air bnbs/i);
  });

  it('prefers Brain items[] when that field is present', () => {
    const note = catalogueGeminiDirective({
      profile: FILE,
      localReply: {
        outcome: 'catalogue',
        line: 'We offer Couch cleaning.',
        items: ['Sofa wash', 'Rug wash'],
      },
    });
    assert.match(note, /Sofa wash; Rug wash/);
    assert.doesNotMatch(note, /Couch cleaning/);
    assert.doesNotMatch(note, /More are on file/);
  });
});

describe('catalogue TTS is one breath', () => {
  it('turns periods and question marks into commas and does not say period', () => {
    const softened = softenCataloguePunctuation(
      'We offer Couch cleaning. Mattress cleaning. Carpet cleaning?'
    );
    assert.equal(
      softened,
      'We offer Couch cleaning, Mattress cleaning, Carpet cleaning,'
    );
    assert.doesNotMatch(softened, /[.!?]/);
    const prepared = prepareForTts(softened, { callLanguage: 'en' });
    assert.doesNotMatch(prepared.text, /\bperiod\b/i);
    assert.match(
      prepared.text,
      /Couch cleaning and Mattress cleaning and Carpet cleaning/
    );
  });
});

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
    const brain = brainFor('Which services do you offer?');
    const local = resolveLocalReply({
      text: 'Which services do you offer?',
      state: brain,
      language: 'en',
      profile: PROFILE,
    });
    assert.equal(local.outcome, 'catalogue');
    assert.match(local.line, /Couch cleaning/);
    assert.match(local.line, /General cleaning/);
    assert.doesNotMatch(local.line, /houses|air bnbs/);
    const gate = planCallerModelTurn(brain);
    assert.equal(gate.runModel, false);
    assert.match(formatBrainStateForPrompt(brain), /^((?!CATALOGUE MOUTH).)*$/s);
  });

  it('lets Gemini run on the first services ask when the flag is on', () => {
    process.env.BRAIN_GEMINI_CATALOGUE = 'on';
    const brain = brainFor('Which services do you offer?');
    const local = resolveLocalReply({
      text: 'Which services do you offer?',
      state: brain,
      language: 'en',
      profile: PROFILE,
    });
    assert.equal(local, null);
    const gate = planCallerModelTurn(brain);
    assert.equal(gate.runModel, true);
    assert.equal(gate.line, '');
    const decision = determineNextBestAction({ state: brain });
    assert.equal(decision.action, 'ANSWER');
    assert.match(decision.reason, /Couch cleaning/);
    assert.match(decision.reason, /Mattress cleaning/);
    assert.match(decision.reason, /Carpet cleaning/);
    assert.match(decision.reason, /General cleaning/);
    assert.doesNotMatch(decision.reason, /houses|air bnbs|Window/);
    const prompted = setNextBestAction(brain, decision);
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
    assert.equal(looksLikeOfferAsk('which service is you offer'), true);
    assert.equal(looksLikeServiceDetailAsk('tell me more about carpet'), true);
    const profile = {
      ...PROFILE,
      servicesCatalog: [
        { name: 'Couch cleaning', price_range: '1500 to 2000' },
        { name: 'Mattress cleaning', notes: 'both sides' },
        { name: 'Carpet cleaning' },
        { name: 'General cleaning' },
      ],
    };
    const brain = brainFor('Tell me details about the services', profile);
    const decision = determineNextBestAction({ state: brain });
    assert.match(decision.reason, /do not read the full catalogue/i);
    const local = resolveLocalReply({
      text: 'Tell me details about the services',
      state: brain,
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
        state: brain,
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
    let brain = brainFor('Which services do you offer?');
    brain = setNextBestAction(brain, determineNextBestAction({ state: brain }));
    brain = observeCallerTurn(brain, {
      text: 'Yes.',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile: PROFILE,
      lastAgentText: 'Am I speaking with Alvin?',
    });
    assert.equal(brain.caller.nameJustConfirmed, true);
    const decision = determineNextBestAction({ state: brain });
    assert.equal(decision.action, 'ANSWER');
    assert.notEqual(decision.action, 'END');
    assert.doesNotMatch(decision.reason, /Speak that list|Speak only these names/i);
    const local = resolveLocalReply({
      text: 'Yes.',
      state: brain,
      profile: PROFILE,
      language: 'en',
    });
    assert.notEqual(local && local.outcome, 'catalogue');
    const spoken = polishSpokenReply(
      'We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning.',
      {
        state: brain,
        callerTurns: ['Yes.'],
        profile: PROFILE,
        language: 'en',
      }
    );
    assert.equal(spoken, 'Which service do you need?');
    const bye = determineNextBestAction({
      state: observeCallerTurn(brain, {
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
    const beforeName = linesBeforeNameAsk({
      localReply: local,
      nameAsk: 'Je, naongea na Alvin?',
      state: {
        caller: { nameConfirmed: false, fileNameAsked: 'Alvin' },
        returning: { name: 'Alvin', fileOwnerName: 'Alvin' },
      },
    });
    assert.deepEqual(beforeName, [
      'Carpet cleaning is Ksh 1500-2000.',
      'Je, naongea na Alvin?',
    ]);
    assert.doesNotMatch(beforeName.join(' '), /CATALOGUE MOUTH/);
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
    const swLocal = resolveLocalReply({
      text: 'Ni pesa ngapi?',
      state: swState,
      profile,
      language: 'sw',
    });
    assert.equal(swLocal.outcome, 'price');
    assert.equal(swLocal.line, 'Carpet cleaning ni Ksh 1500-2000.');
    const swBeforeName = linesBeforeNameAsk({
      localReply: swLocal,
      nameAsk: 'Je, naongea na Alvin?',
      state: {
        caller: { nameConfirmed: false, fileNameAsked: 'Alvin' },
        returning: { name: 'Alvin', fileOwnerName: 'Alvin' },
      },
    });
    assert.deepEqual(swBeforeName, [
      'Carpet cleaning ni Ksh 1500-2000.',
      'Je, naongea na Alvin?',
    ]);
    assert.doesNotMatch(swBeforeName.join(' '), /CATALOGUE MOUTH/);
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
