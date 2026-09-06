// Rule-based Kenyan-name phonetic respelling (build-time only).
// Do not import from the live speakText / prepareForTts path.

const fs = require('fs');
const path = require('path');
const Module = require('module');

/** Longest-first consonant units (trigraph then digraphs). */
const CONSONANT_UNITS = [
  "ng'",
  'ny',
  'ng',
  'ch',
  'sh',
  'th',
  'dh',
  'gh',
  'mb',
  'mv',
  'mp',
  'nd',
  'nj',
  'nz',
  'nk',
  'ts',
  'tw',
  'kw',
  'gw',
  'sw',
];

const DIPHTHONGS = {
  ai: 'y',
  au: 'ow',
};

const OPEN_VOWELS = {
  a: 'ah',
  e: 'eh',
  i: 'ee',
  o: 'oh',
  u: 'oo',
  ai: 'y',
  au: 'ow',
};

const APOSTROPHES = /['\u2018\u2019\u02bc]/g;

let englishWords = null;

function findWordListPath() {
  const roots = Module._nodeModulePaths(__dirname);
  for (const dir of roots) {
    const candidate = path.join(dir, 'word-list', 'words.txt');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadEnglishWords() {
  if (englishWords) return englishWords;
  const filePath = findWordListPath();
  if (!filePath) {
    throw new Error(
      'word-list package is required for isEnglishWord() (npm i -D word-list)'
    );
  }
  englishWords = new Set(
    fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
  );
  return englishWords;
}

function normalizeOrthography(word) {
  return String(word || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(APOSTROPHES, "'");
}

/**
 * True when `word` (or every space-separated part) is in the English list.
 * @param {string} word
 * @returns {boolean}
 */
function isEnglishWord(word) {
  const raw = String(word || '').trim();
  if (!raw) return false;
  const dict = loadEnglishWords();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.every((part) => isEnglishWord(part));
  }
  const hyphenParts = raw.split(/-/).filter(Boolean);
  if (hyphenParts.length > 1) {
    return hyphenParts.every((part) => isEnglishWord(part));
  }
  const key = normalizeOrthography(raw).replace(/[^a-z']/g, '');
  if (!key) return false;
  return dict.has(key);
}

/**
 * @typedef {{ kind: 'C'|'V', raw: string }} PhoneToken
 */

/**
 * Tokenize into consonant units and vowel/diphthong nuclei.
 * @param {string} word
 * @returns {PhoneToken[]}
 */
function tokenize(word) {
  const s = normalizeOrthography(word).replace(/[^a-z']/g, '');
  /** @type {PhoneToken[]} */
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const unit of CONSONANT_UNITS) {
      if (s.startsWith(unit, i)) {
        tokens.push({ kind: 'C', raw: unit });
        i += unit.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const pair = s.slice(i, i + 2);
    if (pair === 'ai' || pair === 'au') {
      tokens.push({ kind: 'V', raw: pair });
      i += 2;
      continue;
    }

    const ch = s[i];
    if ('aeiou'.includes(ch)) {
      tokens.push({ kind: 'V', raw: ch });
      i += 1;
      continue;
    }
    if (ch >= 'a' && ch <= 'z') {
      tokens.push({ kind: 'C', raw: ch });
      i += 1;
      continue;
    }
    i += 1;
  }
  return tokens;
}

/**
 * @typedef {{ onset: PhoneToken[], nucleus: PhoneToken|null, coda: PhoneToken[] }} Syllable
 */

/**
 * Onset is at most one consonant unit. Extra pre-vowel consonants become
 * the previous syllable's coda (kip-rop, not ki-prop). Word-initial extras
 * stay on the first onset because there is no previous syllable.
 * @param {PhoneToken[]} tokens
 * @returns {Syllable[]}
 */
function buildSyllables(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  const nuclei = [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].kind === 'V') nuclei.push(i);
  }
  if (!nuclei.length) {
    if (!list.length) return [];
    return [{ onset: list.filter((t) => t.kind === 'C'), nucleus: null, coda: [] }];
  }

  /** @type {Syllable[]} */
  const syllables = nuclei.map((idx) => ({
    onset: [],
    nucleus: list[idx],
    coda: [],
  }));

  for (let i = 0; i < nuclei[0]; i += 1) {
    if (list[i].kind === 'C') syllables[0].onset.push(list[i]);
  }

  for (let s = 1; s < nuclei.length; s += 1) {
    const cons = [];
    for (let i = nuclei[s - 1] + 1; i < nuclei[s]; i += 1) {
      if (list[i].kind === 'C') cons.push(list[i]);
    }
    if (cons.length <= 1) {
      syllables[s].onset = cons;
    } else {
      syllables[s - 1].coda = cons.slice(0, -1);
      syllables[s].onset = cons.slice(-1);
    }
  }

  const last = syllables.length - 1;
  for (let i = nuclei[nuclei.length - 1] + 1; i < list.length; i += 1) {
    if (list[i].kind === 'C') syllables[last].coda.push(list[i]);
  }
  return syllables;
}

function joinUnits(tokens) {
  return (tokens || []).map((t) => t.raw).join('');
}

/**
 * Open syllables respell the nucleus (a→ah …; ai→y, au→ow).
 * Closed syllables keep the vowel letters as written.
 * @param {Syllable} syl
 * @returns {string}
 */
function respellSyllable(syl) {
  if (!syl) return '';
  const onset = joinUnits(syl.onset);
  const coda = joinUnits(syl.coda);
  if (!syl.nucleus) return onset + coda;
  const open = coda.length === 0;
  const nucleus = open
    ? OPEN_VOWELS[syl.nucleus.raw] || syl.nucleus.raw
    : syl.nucleus.raw;
  return onset + nucleus + coda;
}

function respellToken(raw) {
  const syllables = buildSyllables(tokenize(raw));
  if (!syllables.length) return '';
  const parts = syllables.map(respellSyllable).filter(Boolean);
  if (!parts.length) return '';
  const stressAt = parts.length === 1 ? 0 : parts.length - 2;
  return parts
    .map((part, i) => (i === stressAt ? part.toUpperCase() : part))
    .join('-');
}

/**
 * @param {string} word
 * @param {{ skipEnglish?: boolean }} [opts]
 * @returns {string|null} hyphenated say-form, or null when English bypass applies
 */
function phoneticRespell(word, opts = {}) {
  const skipEnglish = opts.skipEnglish !== false;
  const raw = String(word || '').trim();
  if (!raw) return null;
  if (skipEnglish && isEnglishWord(raw)) return null;

  const spaceParts = raw.split(/\s+/).filter(Boolean);
  const spelled = spaceParts.map((part) => {
    if (skipEnglish && isEnglishWord(part)) return part;
    const bits = part.split(/-/).filter(Boolean);
    if (bits.length > 1) {
      if (skipEnglish && bits.every((bit) => isEnglishWord(bit))) return part;
      return bits
        .map((bit) => {
          if (skipEnglish && isEnglishWord(bit)) return bit;
          return respellToken(bit);
        })
        .filter(Boolean)
        .join('-');
    }
    return respellToken(part);
  });
  const joined = spelled.filter(Boolean).join(' ').trim();
  return joined || null;
}

module.exports = {
  tokenize,
  buildSyllables,
  respellSyllable,
  phoneticRespell,
  isEnglishWord,
};
