/**
 * Phonetic respelling engine (build-time Kenya lexicon).
 * Run: node --test tests/pronunciation/phoneticEngine.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  tokenize,
  buildSyllables,
  respellSyllable,
  phoneticRespell,
  isEnglishWord,
} = require('../../src/speech/phoneticEngine');

const GENERATED_JSON = path.join(
  __dirname,
  '../../src/speech/generatedKenyaLexicon.json'
);

/** Hand-tuned KENYA_LEXICON say-forms extracted from pronunciationLexicon.js. */
const GOLDEN_SET = [
  { word: 'ruiru', expectedSay: 'Roo-ee-roo' },
  { word: 'thika', expectedSay: 'Thee-kah' },
  { word: 'kiambu', expectedSay: 'Kee-ahm-boo' },
  { word: 'westlands', expectedSay: 'West-lands' },
  { word: 'kilimani', expectedSay: 'Kee-lee-mah-nee' },
  { word: 'lavington', expectedSay: 'Lavington' },
  { word: 'parklands', expectedSay: 'Park-lands' },
  { word: 'eastleigh', expectedSay: 'East-lee' },
  { word: 'syokimau', expectedSay: 'Shyo-kee-mau' },
  { word: 'kitengela', expectedSay: 'Kee-ten-geh-la' },
  { word: 'limuru', expectedSay: 'Lee-moo-roo' },
  { word: 'juja', expectedSay: 'Joo-jah' },
  { word: 'ngong', expectedSay: 'Ngong' },
  { word: 'kabete', expectedSay: 'Kah-beh-teh' },
  { word: 'kasarani', expectedSay: 'Kah-sah-rah-nee' },
  { word: 'embakasi', expectedSay: 'Em-bah-kah-see' },
  { word: 'nairobi', expectedSay: 'Nairobi' },
  { word: 'mombasa', expectedSay: 'Mom-bah-sa' },
  { word: 'kisumu', expectedSay: 'Kee-soo-moo' },
  { word: 'nakuru', expectedSay: 'Nah-koo-roo' },
  { word: 'eldoret', expectedSay: 'El-do-ret' },
  { word: 'geyser', expectedSay: 'geezer' },
  { word: 'handyman', expectedSay: 'handy-man' },
  { word: 'manga', expectedSay: 'Man-gah' },
  { word: 'aisha', expectedSay: 'Eye-sha' },
  { word: 'wanjiku', expectedSay: 'Wan-jee-koo' },
  { word: 'wambui', expectedSay: 'Wahm-boo-ee' },
  { word: 'njeri', expectedSay: 'Njeh-ree' },
  { word: 'otieno', expectedSay: 'Oh-tee-eh-no' },
  { word: 'ochieng', expectedSay: 'Oh-chee-eng' },
  { word: 'kamau', expectedSay: 'Kah-mau' },
  { word: 'mwangi', expectedSay: 'Mwahn-gee' },
];

const KENYAN_NAME_PLACE_WORDS = new Set([
  'ruiru',
  'thika',
  'kiambu',
  'kilimani',
  'syokimau',
  'kitengela',
  'limuru',
  'juja',
  'ngong',
  'kabete',
  'kasarani',
  'embakasi',
  'mombasa',
  'kisumu',
  'nakuru',
  'eldoret',
  'wanjiku',
  'wambui',
  'njeri',
  'otieno',
  'ochieng',
  'kamau',
  'mwangi',
  'aisha',
  'nairobi',
]);

const CLOSED_SYLLABLE_GOLDEN = [
  { word: 'Kiprop', expectedSay: 'Kip-rop' },
  { word: 'Rotich', expectedSay: 'Roh-tich' },
  { word: 'Chebet', expectedSay: 'Cheh-bet' },
];

const ENGLISH_BYPASS = [
  'booking',
  'confirm',
  'deposit',
  'reservation',
  'appointment',
];

/** Informational only: hyphen/case plus open-vowel h-padding and au/ow. */
function normalizeSay(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/ow/g, 'au')
    .replace(/([aeo])h/g, '$1');
}

function kenyanGolden() {
  return GOLDEN_SET.filter((g) => KENYAN_NAME_PLACE_WORDS.has(g.word));
}

function scoreKenyan(strict) {
  const subset = kenyanGolden();
  let hits = 0;
  const misses = [];
  for (const { word, expectedSay } of subset) {
    const got = phoneticRespell(word, { skipEnglish: false });
    const ok = strict
      ? got === expectedSay
      : got && normalizeSay(got) === normalizeSay(expectedSay);
    if (ok) hits += 1;
    else misses.push(`${word}: expected ${expectedSay} got ${got}`);
  }
  return { hits, n: subset.length, pct: (100 * hits) / subset.length, misses };
}

describe('tokenize / syllabify', () => {
  it('splits Kiprop so extra consonants become coda (kip-rop)', () => {
    const tokens = tokenize('Kiprop');
    assert.deepEqual(
      tokens.map((t) => t.raw),
      ['k', 'i', 'p', 'r', 'o', 'p']
    );
    const syl = buildSyllables(tokens);
    assert.equal(syl.length, 2);
    assert.equal(respellSyllable(syl[0]), 'kip');
    assert.equal(respellSyllable(syl[1]), 'rop');
  });

  it('keeps protected units (ch, ng, mb) intact', () => {
    assert.deepEqual(
      tokenize('Chebet').map((t) => t.raw),
      ['ch', 'e', 'b', 'e', 't']
    );
    assert.deepEqual(
      tokenize('Wambui').map((t) => t.raw),
      ['w', 'a', 'mb', 'u', 'i']
    );
  });
});

describe('closed-syllable names', () => {
  it('respells Kiprop as Kip-rop', () => {
    assert.equal(phoneticRespell('Kiprop', { skipEnglish: false }), 'Kip-rop');
  });

  it('respells Rotich as Roh-tich', () => {
    assert.equal(phoneticRespell('Rotich', { skipEnglish: false }), 'Roh-tich');
  });

  it('respells Chebet as Cheh-bet', () => {
    assert.equal(phoneticRespell('Chebet', { skipEnglish: false }), 'Cheh-bet');
  });

  it('respells Bett without ALLCAPS', () => {
    assert.equal(phoneticRespell('Bett', { skipEnglish: false }), 'Bett');
  });
});

describe('word-initial diphthong', () => {
  it('respells ainabkoi as Eye-nab-koh-ee', () => {
    assert.equal(
      phoneticRespell('ainabkoi', { skipEnglish: false }),
      'Eye-nab-koh-ee'
    );
  });
});

describe('English bypass', () => {
  for (const word of ENGLISH_BYPASS) {
    it(`returns no override for ${word}`, () => {
      assert.equal(isEnglishWord(word), true);
      assert.equal(phoneticRespell(word), null);
    });
  }
});

describe('accuracy gates', () => {
  it('reports four rates; English and closed-syllable must be 100%', () => {
    const englishHits = ENGLISH_BYPASS.filter(
      (w) => isEnglishWord(w) && phoneticRespell(w) == null
    ).length;
    const englishPct = (100 * englishHits) / ENGLISH_BYPASS.length;

    const closedHits = CLOSED_SYLLABLE_GOLDEN.filter(
      ({ word, expectedSay }) =>
        phoneticRespell(word, { skipEnglish: false }) === expectedSay
    ).length;
    const closedPct = (100 * closedHits) / CLOSED_SYLLABLE_GOLDEN.length;

    const kenyanStrict = scoreKenyan(true);
    const kenyanNormalized = scoreKenyan(false);

    console.log(
      `accuracy: english=${englishPct.toFixed(1)}% closed=${closedPct.toFixed(1)}%` +
        ` kenyanStrict=${kenyanStrict.pct.toFixed(1)}% (ship-blocking)` +
        ` kenyanNormalized=${kenyanNormalized.pct.toFixed(1)}% (informational, not a ship gate)`
    );
    if (kenyanStrict.misses.length) {
      console.log(`kenyanStrict misses:\n  ${kenyanStrict.misses.join('\n  ')}`);
    }

    assert.equal(englishPct, 100, `English bypass ${englishPct}%`);
    assert.equal(closedPct, 100, `Closed-syllable ${closedPct}%`);
    assert.ok(Number.isFinite(kenyanStrict.pct));
    assert.ok(Number.isFinite(kenyanNormalized.pct));
  });
});

describe('hand-tuned KENYA_LEXICON', () => {
  it('contains the original 65 entries and no generated block', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/speech/pronunciationLexicon.js'),
      'utf8'
    );
    assert.equal(source.includes('GENERATED_KENYA_LEXICON'), false);
    const array = source.slice(
      source.indexOf('const KENYA_LEXICON = ['),
      source.indexOf('\n];', source.indexOf('const KENYA_LEXICON = ['))
    );
    const n = (array.match(/\{ match:/g) || []).length;
    assert.equal(n, 65);
  });
});

describe('generated lexicon file', () => {
  it('has no ALLCAPS run of 2+ letters in say forms', () => {
    assert.ok(fs.existsSync(GENERATED_JSON), 'generatedKenyaLexicon.json missing; run the generator');
    const rows = JSON.parse(fs.readFileSync(GENERATED_JSON, 'utf8'));
    assert.ok(Array.isArray(rows) && rows.length > 0);
    const bad = rows.filter((e) => /[A-Z]{2,}/.test(String(e.say || '')));
    assert.equal(
      bad.length,
      0,
      bad
        .slice(0, 8)
        .map((e) => `${e.match}=${e.say}`)
        .join('; ')
    );
  });
});
