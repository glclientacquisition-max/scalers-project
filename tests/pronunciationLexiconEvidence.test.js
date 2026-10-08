// Place respellings need listening evidence (2026-10-08 town A/B on #612).
// Hyphenated syllable splits made place names choppy and misheard (Kiambu ->
// "Kigambo", Juja -> "Georgia", Ruiru -> "Rui Rou"); the plain names were
// heard correctly. Only Westlands kept its respelling.
// Run: node --test tests/pronunciationLexiconEvidence.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const INDEX = require('../src/conversation/data/kenyaPlaceCounties.json');
const { KENYA_LEXICON, PLACE_LEXICON, applyLexicon } = require('../src/speech/pronunciationLexicon');
const { prepareForTts } = require('../src/speech/ttsNormalize');

/** Entries whose match is also a Kenya place name but mean something else. */
const NOT_A_PLACE = new Map([['manga', 'the comic genre (retail section)']]);

function matchLiterals(match) {
  return String(match)
    .replace(/\\b/g, '')
    .split('|')
    .map((alt) =>
      alt
        .replace(/\\s\+|\\s\*/g, ' ')
        .replace(/[\\?()[\]'’]/g, '')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
}

const norm = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

function isRespelling(entry) {
  return !matchLiterals(entry.match).includes(norm(entry.say));
}

function isKenyaPlace(literal) {
  return Boolean(INDEX.places[literal]) || INDEX.counties.includes(literal);
}

describe('place respellings carry verified evidence', () => {
  it('every place respelling has a verified note (date, voice id, TTS, STT, source)', () => {
    const missing = [];
    for (const entry of PLACE_LEXICON) {
      if (!isRespelling(entry)) continue;
      const v = entry.verified || {};
      const problems = [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date || ''))) problems.push('date');
      if (!/^[0-9a-f-]{8,}$/i.test(String(v.voiceId || ''))) problems.push('voiceId');
      for (const key of ['tts', 'stt', 'source']) {
        if (!String(v[key] || '').trim()) problems.push(key);
      }
      if (problems.length) missing.push(`${entry.match} -> ${entry.say}: ${problems.join(', ')}`);
    }
    assert.deepEqual(missing, []);
  });

  it('the evidence check catches a respelling without a note', () => {
    const bad = { match: 'juja', say: 'Joo-jah' };
    assert.equal(isRespelling(bad), true);
    assert.equal(Boolean(bad.verified), false);
    assert.equal(isRespelling({ match: 'ongata\\s+rongai', say: 'Ongata Rongai' }), false);
  });

  it('no place entry lives outside PLACE_LEXICON', () => {
    const stray = [];
    for (const entry of KENYA_LEXICON) {
      if (PLACE_LEXICON.includes(entry)) continue;
      for (const literal of matchLiterals(entry.match)) {
        if (isKenyaPlace(literal) && !NOT_A_PLACE.has(literal)) stray.push(`${entry.match} -> ${entry.say}`);
      }
    }
    assert.deepEqual(stray, []);
  });

  it('PLACE_LEXICON entries are in KENYA_LEXICON and are Kenya places', () => {
    for (const entry of PLACE_LEXICON) {
      assert.ok(KENYA_LEXICON.includes(entry), `${entry.match} not applied`);
      assert.ok(matchLiterals(entry.match).some(isKenyaPlace), `${entry.match} is not a Kenya place`);
    }
  });
});

describe('place names are spoken as written', () => {
  const plain = [
    'Kitengela', 'Syokimau', 'Kiambu', 'Juja', 'Ruiru', 'Thika', 'Kilimani', 'Embakasi',
    'Kasarani', 'Limuru', 'Kabete', 'Langata', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret',
    'Parklands', 'Eastleigh', 'Muindi Mbingu', 'Ongata Rongai', 'Athi River', 'Nairobi',
  ];
  for (const town of plain) {
    it(`${town} reaches Soniox unchanged`, () => {
      assert.equal(applyLexicon(`Yes we cover ${town} too`, 'en'), `Yes we cover ${town} too`);
      const prepared = prepareForTts(`Yes, we cover ${town}.`, { callLanguage: 'en' }).text;
      assert.equal(prepared, `Yes, we cover ${town}.`);
    });
  }

  it('Westlands keeps its verified respelling', () => {
    assert.equal(prepareForTts('Yes, we cover Westlands.', { callLanguage: 'en' }).text, 'Yes, we cover West-lands.');
  });
});
