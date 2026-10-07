// Catalogue mouth: Gemini listen is opt-in. Default is the Phase-0 local line.
// Run: node --test tests/catalogueMouth.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { catalogueFileNames } = require('../src/conversation/knownFacts');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { prepareForTts } = require('../src/speech/ttsNormalize');
const {
  catalogueGeminiDirective,
  geminiCatalogueEnabled,
  planCatalogueMouth,
  softenCataloguePunctuation,
} = require('../src/speech/catalogueMouth');

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

  it('lets Gemini speak when the flag is on and reasoning is up', () => {
    const local = catalogueReply('en');
    const mouth = planCatalogueMouth({
      localReply: local,
      reasoningDown: false,
      geminiCatalogue: true,
    });
    assert.equal(mouth.speakLocal, false);
    assert.equal(mouth.letGemini, true);
    assert.equal(mouth.reason, 'gemini');
    assert.equal(mouth.line, local.line);
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
