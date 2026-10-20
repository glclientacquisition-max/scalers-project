'use strict';
// Speak catalogue names the way a caller says them. File titles stay the
// source of truth; this only expands size tokens so TTS does not read
// "1 bedroom" as "moja bedroom" in Kiswahili.
// Size words match the lookup matcher: chumba kimoja / vyumba viwili.

const EN_NUM = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
};

const SW_NUM = {
  1: 'moja',
  2: 'mbili',
  3: 'tatu',
  4: 'nne',
  5: 'tano',
  6: 'sita',
  7: 'saba',
  8: 'nane',
  9: 'tisa',
  10: 'kumi',
};

const SW_BEDROOM = {
  1: 'chumba kimoja',
  2: 'vyumba viwili',
  3: 'vyumba vitatu',
  4: 'vyumba vinne',
  5: 'vyumba vitano',
};

function isSw(language) {
  const lang = String(language || 'en').toLowerCase();
  return lang === 'sw' || lang === 'sheng';
}

function mouthName(name) {
  return String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} name
 * @param {string} [language]
 * @returns {string}
 */
function speakCatalogueName(name, language = 'en') {
  let spoken = mouthName(name);
  if (!spoken) return '';
  const sw = isSw(language);
  spoken = spoken.replace(/\b(\d{1,2})\s*-?\s*bedrooms?\b/gi, (_, raw) => {
    const n = Number(raw);
    if (sw) return SW_BEDROOM[n] || `bedroom ${SW_NUM[n] || raw}`;
    return `${EN_NUM[n] || raw} bedroom`;
  });
  spoken = spoken.replace(/\b(\d{1,2})\b/g, (raw) => {
    const n = Number(raw);
    if (sw) return SW_NUM[n] || raw;
    return EN_NUM[n] || raw;
  });
  return spoken.replace(/\s+/g, ' ').trim();
}

function speakCatalogueNames(names, language = 'en') {
  return (Array.isArray(names) ? names : [])
    .map((name) => speakCatalogueName(name, language))
    .filter(Boolean);
}

module.exports = { speakCatalogueName, speakCatalogueNames, mouthName };
