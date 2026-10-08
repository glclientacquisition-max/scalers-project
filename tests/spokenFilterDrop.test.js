// Staging HD_053dd373ee84 spoke 30 of 138 characters.
// Staging HD_f32a2b7caafd spoke none of the services answer.
// huduma/nyumba were fuzzy places, and the Kiswahili services ask was not an offer ask.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { bindSpokenPlace, canonicalPlaceName } = require('../src/conversation/kenyaPlaces');
const { looksLikeOfferAsk } = require('../src/conversation/fileRead');
const { polishSpokenReply, trimSpokenServiceDump } = require('../src/conversation/dynamicSpeech');
const { createBrainState } = require('../src/conversation/brainState');

const HD_053_CALLER = 'Ni services gani mna offer?';
const HD_053_GEMINI =
  'Huduma zetu ni usafi wa nyumba, usafi wa ofisi, fumigation, na carpet cleaning. Bei inaanzia elfu tano. Ungependa tukuhudumie na gani?';
const HD_053_SPOKEN =
  'Huduma zetu ni usafi wa nyumba, usafi wa ofisi, fumigation, na carpet cleaning. Ungependa tukuhudumie na gani?';

const HD_F32_CALLER = 'Mnaofa services gani?';
const HD_F32_GEMINI = 'Tuna usafi wa nyumba, ofisi, na fumigation leo.';

const EN_CALLER = 'What services do you offer?';
const EN_GEMINI = 'Hello. We do couch cleaning, carpet cleaning, and mattress cleaning.';

function speak(caller, gemini, language) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => {
    warns.push(args.join(' '));
  };
  try {
    const state = createBrainState({ businessName: 'Chapter One', vertical: 'home_services' });
    const text = polishSpokenReply(gemini, {
      callerTurns: [caller],
      profile: { businessName: 'Chapter One' },
      state,
      language,
    });
    return { text, warns };
  } finally {
    console.warn = orig;
  }
}

describe('place names stay exact for Kiswahili and short words', () => {
  it('does not fuzzy-match huduma, nyumba, nataka, shida, or hello', () => {
    assert.equal(canonicalPlaceName('huduma'), '');
    assert.equal(canonicalPlaceName('nyumba'), '');
    assert.equal(canonicalPlaceName('nataka'), '');
    assert.equal(canonicalPlaceName('shida'), '');
    assert.equal(canonicalPlaceName('hello'), '');
    assert.equal(canonicalPlaceName('those'), '');
    assert.equal(canonicalPlaceName('rwaka'), 'ruaka');
    assert.equal(canonicalPlaceName('huruma'), 'huruma');
    assert.equal(canonicalPlaceName('ngumba'), 'ngumba');
    assert.equal(canonicalPlaceName('Ronga'), 'rongai');
    assert.equal(canonicalPlaceName('Rungai'), 'rongai');
    assert.equal(canonicalPlaceName('ndani'), '');
    assert.equal(canonicalPlaceName('kwako'), '');
    assert.equal(canonicalPlaceName('kwangu'), '');
    assert.equal(canonicalPlaceName('kilicho'), '');
    assert.equal(canonicalPlaceName('ndanai'), 'ndanai');
    assert.deepEqual(bindSpokenPlace('OngataRongai'), ['ongata rongai']);
    assert.deepEqual(bindSpokenPlace('na kuru'), ['nakuru']);
    assert.deepEqual(bindSpokenPlace('Nairobini'), ['nairobi']);
    assert.deepEqual(bindSpokenPlace('Nakuruni'), ['nakuru']);
    assert.deepEqual(bindSpokenPlace('mara moja', { fuzzy: true }), []);
    assert.deepEqual(bindSpokenPlace('Kilicho iko outside Nairobi', { fuzzy: true }), ['nairobi']);
    assert.deepEqual(
      bindSpokenPlace('Kama upo ndani ya Nairobi, tutafika kwako.', { fuzzy: true }),
      ['nairobi']
    );
  });
});

describe('services asks keep the list', () => {
  it('keeps the Kiswahili list from HD_053dd373ee84', () => {
    assert.equal(looksLikeOfferAsk(HD_053_CALLER), true);
    const { text, warns } = speak(HD_053_CALLER, HD_053_GEMINI, 'sw');
    assert.equal(text, HD_053_SPOKEN);
    assert.ok(text.length > 30, text.length);
    assert.notEqual(text, 'Ungependa tukuhudumie na gani?');
    assert.notEqual(text, 'Tunaweza kusaidia. Unahitaji huduma gani?');
    assert.equal(warns.some((line) => line.includes('reason=unbound_place')), false);
    assert.equal(warns.some((line) => line.includes('reason=service_dump')), false);
    assert.equal(warns.some((line) => line.includes('reason=unsaid_number')), true);
  });

  it('keeps the Kiswahili list from HD_f32a2b7caafd', () => {
    assert.equal(looksLikeOfferAsk(HD_F32_CALLER), true);
    const { text, warns } = speak(HD_F32_CALLER, HD_F32_GEMINI, 'sw');
    assert.equal(text, HD_F32_GEMINI);
    assert.equal(warns.length, 0);
  });

  it('keeps an English services list, including a short hello', () => {
    assert.equal(looksLikeOfferAsk(EN_CALLER), true);
    assert.equal(looksLikeOfferAsk('Which services do you offer?'), true);
    const { text, warns } = speak(EN_CALLER, EN_GEMINI, 'en');
    assert.equal(text, EN_GEMINI);
    assert.match(text, /Hello/);
    assert.match(text, /couch cleaning/);
    assert.equal(warns.some((line) => line.includes('reason=unbound_place')), false);
    assert.equal(warns.some((line) => line.includes('reason=service_dump')), false);
  });
});

describe('a real drop is logged', () => {
  it('logs when an unasked catalogue is replaced', () => {
    const raw = "I'm doing well, thank you! We specialize in couch, carpet, and mattress cleaning.";
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => {
      warns.push(args.join(' '));
    };
    try {
      const line = trimSpokenServiceDump(raw);
      assert.equal(line, 'We can help with that. What do you need done?');
      assert.equal(warns.length, 1);
      assert.match(warns[0], /\[speech-filter\] drop reason=service_dump/);
      assert.match(warns[0], /couch, carpet, and mattress/);
    } finally {
      console.warn = orig;
    }
  });

  it('logs when a sentence names a place the caller did not say', () => {
    const { text, warns } = speak('Can you come tomorrow?', 'The couch cleaning is for Rongai.', 'en');
    assert.equal(text, '');
    assert.equal(warns.some((line) => /reason=unbound_place/.test(line) && /Rongai/.test(line)), true);
  });
});
