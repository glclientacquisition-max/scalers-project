// Numbers a sentence states, as digit strings. "KSh 6,000" -> 6000,
// "800-1200" -> 800 and 1200, "two hundred" -> 200, "elfu sita" -> 6000.
// Used only to check a spoken number against tenant facts and the caller's
// own words; it never rewrites text.

const EN_UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const EN_SCALES = { hundred: 100, thousand: 1000, million: 1000000 };
const SW_UNITS = {
  moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
  ishirini: 20, thelathini: 30, arobaini: 40, hamsini: 50, sitini: 60, sabini: 70, themanini: 80, tisini: 90,
};
const SW_SCALES = { mia: 100, elfu: 1000 };

function digitNumbers(text) {
  const out = [];
  const raw = String(text || '');
  for (const hit of raw.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    out.push(String(Number(hit[0].replace(/,/g, ''))));
  }
  return out;
}

function englishNumberWords(text) {
  const out = [];
  const words = String(text || '').toLowerCase().replace(/-/g, ' ').split(/[^a-z]+/);
  let total = 0;
  let current = 0;
  let active = false;
  let phrase = [];
  const flush = () => {
    // A lone "one" is a pronoun ("which one", "this one"), not a figure.
    if (active && !(phrase.length === 1 && phrase[0] === 'one')) out.push(String(total + current));
    total = 0;
    current = 0;
    active = false;
    phrase = [];
  };
  for (const word of words) {
    if (Object.prototype.hasOwnProperty.call(EN_UNITS, word)) {
      current += EN_UNITS[word];
      active = true;
      phrase.push(word);
    } else if (EN_SCALES[word] && active) {
      phrase.push(word);
      if (EN_SCALES[word] === 100) current *= 100;
      else {
        total += current * EN_SCALES[word];
        current = 0;
      }
    } else if (word === 'and' && active) {
      continue;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

function swahiliNumberWords(text) {
  const out = [];
  const words = String(text || '').toLowerCase().split(/[^a-z]+/);
  for (let i = 0; i < words.length; i += 1) {
    const scale = SW_SCALES[words[i]];
    if (!scale) continue;
    let n = 0;
    let j = i + 1;
    while (j < words.length && (SW_UNITS[words[j]] != null || words[j] === 'na')) {
      if (words[j] !== 'na') n += SW_UNITS[words[j]];
      j += 1;
    }
    out.push(String(scale * (n || 1)));
    i = j - 1;
  }
  return out;
}

/** @returns {Set<string>} */
function statedNumbers(text) {
  return new Set([...digitNumbers(text), ...englishNumberWords(text), ...swahiliNumberWords(text)]);
}

module.exports = { statedNumbers, digitNumbers };
