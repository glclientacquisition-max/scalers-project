// Rewrite light Sheng into speakable forms for English TTS (no native Sheng voice).

/**
 * Prefer short phonetic / natural substitutes Soniox English can say clearly.
 * Longer phrases first.
 */
const SHENG_SAY = [
  { match: 'nimechill', say: 'nee-meh-chill' },
  { match: 'nimebamba', say: 'nee-meh-bamba' },
  { match: 'soft life', say: 'soft life' },
  { match: 'tuko spot', say: 'too-koh spot' },
  { match: 'msee wangu', say: 'mseh wangu' },
  { match: 'poa sana', say: 'poh-ah sana' },
  { match: 'niko poa', say: 'nee-koh poh-ah' },
  { match: 'nko poa', say: 'n-koh poh-ah' },
  { match: 'niaje', say: 'nee-ah-jay' },
  { match: 'manze', say: 'man-zeh' },
  { match: 'maze', say: 'mah-zeh' },
  { match: 'msee', say: 'mseh' },
  { match: 'faro', say: 'fah-ro' },
  { match: 'udae', say: 'oo-dah-eh' },
  { match: 'poa', say: 'poh-ah' },
  { match: 'sasa', say: 'sah-sah' },
];

const COMPILED = SHENG_SAY.map((entry, index) => ({
  ...entry,
  index,
  re: new RegExp(`\\b${entry.match}\\b`, 'gi'),
})).sort((a, b) => b.match.length - a.match.length || a.index - b.index);

const SHENG_DETECT =
  /\b(niaje|maze|msee|manze|poa sana|niko poa|nko poa|faro|soft life|nimechill|nimebamba|tuko spot|udae)\b/i;

/**
 * True when sticky language is Sheng or the line itself looks Sheng-heavy.
 * @param {string} text
 * @param {string} [callLanguage]
 */
function shouldRewriteSheng(text, callLanguage) {
  if (callLanguage === 'sheng') return true;
  return SHENG_DETECT.test(String(text || ''));
}

/**
 * Rewrite Sheng tokens into speakable English-TTS forms.
 * @param {string} text
 */
function rewriteShengForTts(text) {
  let out = String(text || '');
  if (!out) return out;
  for (const entry of COMPILED) {
    out = out.replace(entry.re, entry.say);
  }
  return out;
}

module.exports = {
  SHENG_SAY,
  shouldRewriteSheng,
  rewriteShengForTts,
};
