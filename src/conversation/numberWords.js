// One table for spoken numbers. The speech guard, the tool guard, and quantity
// extraction must agree that "five", "tano", and "5" are the same caller fact.
// "one" and "moja" are left out of the guard set: "one moment" is not a number.

const NUMBER_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  thousand: 1000, dozen: 12,
  mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
  ishirini: 20, thelathini: 30, arobaini: 40, hamsini: 50, sitini: 60, sabini: 70,
  themanini: 80, tisini: 90, mia: 100, elfu: 1000,
};

const QUANTITY_WORDS = { ...NUMBER_WORDS, one: 1, moja: 1 };

const STANDALONE_DIGITS = /(?<![\w-])\d[\d,]*(?:\.\d+)?(?![\w-])/g;
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi');
const QUANTITY_WORD_RE = new RegExp(`\\b(${Object.keys(QUANTITY_WORDS).join('|')})\\b`, 'i');
const RANGE_RE = /(\d[\d,]*)(?:\s*[-–—]\s*|\s+(?:to|hadi|mpaka)\s+)(\d[\d,]*)/gi;

function digitBody(raw) {
  return String(raw || '').replace(/[^\d.]/g, '').replace(/^0+(?=\d)/, '');
}

/** A catalogue price span. A hyphenated phone (0712-345678) is not a price. */
function rangeIsPrice(left, right) {
  const a = String(left || '').replace(/\D/g, '');
  const b = String(right || '').replace(/\D/g, '');
  if (!a || !b || a.length > 6 || b.length > 6) return false;
  if (a.length + b.length >= 8 && /^0/.test(a)) return false;
  return true;
}

/** Every number a text states, as canonical digit strings. */
function numbersIn(text) {
  const out = new Set();
  const raw = String(text || '');
  for (const hit of raw.matchAll(RANGE_RE)) {
    if (!rangeIsPrice(hit[1], hit[2])) continue;
    const left = digitBody(hit[1]);
    const right = digitBody(hit[2]);
    if (left) out.add(left);
    if (right) out.add(right);
  }
  for (const hit of raw.match(STANDALONE_DIGITS) || []) {
    out.add(digitBody(hit));
  }
  // HH:MM contributes its hour. It does not authorize the other 12-hour form.
  for (const hit of raw.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    out.add(String(Number(hit[1])));
  }
  for (const hit of raw.match(NUMBER_WORD_RE) || []) {
    out.add(String(NUMBER_WORDS[hit.toLowerCase()]));
  }
  return out;
}

/** First spoken count word in a text ("five", "tano", "a dozen") as digits, or null. */
function quantityWord(text) {
  const hit = QUANTITY_WORD_RE.exec(String(text || ''));
  return hit ? String(QUANTITY_WORDS[hit[1].toLowerCase()]) : null;
}

module.exports = {
  NUMBER_WORDS,
  QUANTITY_WORDS,
  numbersIn,
  quantityWord,
};
