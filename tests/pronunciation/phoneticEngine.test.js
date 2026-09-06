/**
 * Phonetic respelling engine (build-time Kenya lexicon).
 * Run: node --test tests/pronunciation/phoneticEngine.test.js
 */
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  tokenize,
  buildSyllables,
  respellSyllable,
  phoneticRespell,
  isEnglishWord,
} = require('../../src/speech/phoneticEngine');

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

/** Hyphen/case plus open-vowel h-padding and au/ow (engine vs light hand respell). */
function normalizeSay(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/ow/g, 'au')
    .replace(/([aeo])h/g, '$1');
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
  it('respells Kiprop as KIP-rop', () => {
    assert.equal(phoneticRespell('Kiprop', { skipEnglish: false }), 'KIP-rop');
  });

  it('respells Rotich as ROH-tich', () => {
    assert.equal(phoneticRespell('Rotich', { skipEnglish: false }), 'ROH-tich');
  });

  it('respells Chebet as CHEH-bet', () => {
    assert.equal(phoneticRespell('Chebet', { skipEnglish: false }), 'CHEH-bet');
  });
});

describe('English bypass', () => {
  for (const word of ['booking', 'confirm', 'deposit', 'reservation', 'appointment']) {
    it(`returns no override for ${word}`, () => {
      assert.equal(isEnglishWord(word), true);
      assert.equal(phoneticRespell(word), null);
    });
  }
});

describe('golden-set accuracy vs hand-tuned KENYA_LEXICON', () => {
  it('matches at least 80% ignoring hyphen and case', () => {
    let hits = 0;
    const misses = [];
    for (const { word, expectedSay } of GOLDEN_SET) {
      const got = phoneticRespell(word, { skipEnglish: false });
      if (got && normalizeSay(got) === normalizeSay(expectedSay)) {
        hits += 1;
      } else {
        misses.push(`${word}: expected ${expectedSay} got ${got}`);
      }
    }
    const rate = hits / GOLDEN_SET.length;
    assert.ok(
      rate >= 0.8,
      `accuracy ${hits}/${GOLDEN_SET.length} = ${(rate * 100).toFixed(1)}% < 80%\n${misses.join('\n')}`
    );
  });
});
