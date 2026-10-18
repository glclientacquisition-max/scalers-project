// One table for spoken numbers. The speech guard, the tool guard, and quantity
// extraction must agree that "five", "tano", and "5" are the same caller fact.
// "one" and "moja" are left out of the bare guard set: "one moment" is not a
// number. They still count inside a compound ("one hundred", "mia moja").

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

/** Ones that only count inside a compound (never alone as a spoken fee). */
const COMPOUND_ONES = { one: 1, moja: 1 };

const STANDALONE_DIGITS = /(?<![\w-])\d[\d,]*(?:\.\d+)?(?![\w-])/g;
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi');
const QUANTITY_WORD_RE = new RegExp(`\\b(${Object.keys(QUANTITY_WORDS).join('|')})\\b`, 'i');
const RANGE_RE = /(\d[\d,]*)(?:\s*[-–—]\s*|\s+(?:to|hadi|mpaka)\s+)(\d[\d,]*)/gi;
const TOKEN_RE = /[A-Za-z]+|\d[\d,]*(?:\.\d+)?/g;

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

// Model text can arrive with a space missing ("from9:30 AM", "costs KSh500";
// HD_49d726c3dc9b). For reading numbers only, a clock or a shilling amount glued
// to the word before it is read as if spaced. The spoken text is never changed.
// Product codes ("A4", "fx991") stay glued and are still not read as numbers.
const GLUED_CLOCK = /([A-Za-z])(?=\d{1,2}:\d{2}(?!\d))/g;
const GLUED_SHILLINGS = /\b(ksh|kes|sh)\.?(?=\d)/gi;
const GLUED_AMOUNT = /([A-Za-z])(?=\d[\d,]*(?:\.\d+)?\s*(?:shillings?|bob|ksh|kes|\/=))/gi;

function numberReadingText(text) {
  return String(text || '').replace(GLUED_CLOCK, '$1 ').replace(GLUED_SHILLINGS, '$1 ').replace(GLUED_AMOUNT, '$1 ');
}

function wordVal(tok) {
  const t = String(tok || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, t)) return NUMBER_WORDS[t];
  if (Object.prototype.hasOwnProperty.call(COMPOUND_ONES, t)) return COMPOUND_ONES[t];
  return null;
}

function isAnd(tok) {
  const t = String(tok || '').toLowerCase();
  return t === 'and' || t === 'na';
}

/** 1–99 from EN/SW words at i. */
function readUnder100(tokens, i) {
  if (i >= tokens.length) return null;
  const a = String(tokens[i] || '').toLowerCase();
  const av = wordVal(a);
  if (av == null) return null;

  if (av >= 1 && av <= 19) return { value: av, next: i + 1 };

  if (av >= 20 && av <= 90 && av % 10 === 0) {
    let next = i + 1;
    if (isAnd(tokens[next])) {
      const b = wordVal(tokens[next + 1]);
      if (b != null && b >= 1 && b <= 9) return { value: av + b, next: next + 2 };
      // "na" not followed by ones — leave it for the next clause
      return { value: av, next: i + 1 };
    }
    const b = wordVal(tokens[next]);
    if (b != null && b >= 1 && b <= 9) return { value: av + b, next: next + 1 };
    return { value: av, next: i + 1 };
  }
  return null;
}

/**
 * One EN/SW spoken amount starting at i.
 * "mia tatu", "three hundred", "elfu moja na mia tano", "mia tatu na hamsini".
 * Stops before a non-number "na"/"and" ("mia tatu na tunasafisha" → 300).
 */
function readAmountPhrase(tokens, i) {
  if (i >= tokens.length) return null;
  const w = String(tokens[i] || '').toLowerCase();

  // --- Kiswahili: mia [ones]? [na| ] under100? ---
  if (w === 'mia') {
    let next = i + 1;
    let mult = 1;
    const ones = wordVal(tokens[next]);
    if (ones != null && ones >= 1 && ones <= 9) {
      mult = ones;
      next += 1;
    }
    let value = mult * 100;
    if (isAnd(tokens[next])) {
      const under = readUnder100(tokens, next + 1);
      if (under) return { value: value + under.value, next: under.next };
      return { value, next };
    }
    const under = readUnder100(tokens, next);
    // Tens after hundreds without "na": "mia tatu hamsini"
    if (under && under.value >= 10) return { value: value + under.value, next: under.next };
    return { value, next };
  }

  // --- Kiswahili: elfu [under100] [na rest]? ---
  if (w === 'elfu') {
    let next = i + 1;
    let mult = 1;
    const under = readUnder100(tokens, next);
    if (under) {
      mult = under.value;
      next = under.next;
    }
    let value = mult * 1000;
    if (isAnd(tokens[next])) {
      const rest = readAmountPhrase(tokens, next + 1);
      if (rest) return { value: value + rest.value, next: rest.next };
      return { value, next };
    }
    const rest = readAmountPhrase(tokens, next);
    if (rest && (String(tokens[next] || '').toLowerCase() === 'mia' || rest.value >= 100)) {
      return { value: value + rest.value, next: rest.next };
    }
    return { value, next };
  }

  // --- English: [ones] hundred [and]? [under100]? ---
  // --- English: [under100] thousand [and]? [rest]? ---
  const lead = readUnder100(tokens, i);
  if (lead) {
    const scale = String(tokens[lead.next] || '').toLowerCase();
    if (scale === 'hundred' && lead.value >= 1 && lead.value <= 9) {
      let next = lead.next + 1;
      let value = lead.value * 100;
      if (isAnd(tokens[next])) {
        const under = readUnder100(tokens, next + 1);
        if (under) return { value: value + under.value, next: under.next };
        return { value, next };
      }
      const under = readUnder100(tokens, next);
      if (under) return { value: value + under.value, next: under.next };
      return { value, next };
    }
    if (scale === 'thousand') {
      let next = lead.next + 1;
      let value = lead.value * 1000;
      if (isAnd(tokens[next])) {
        const rest = readAmountPhrase(tokens, next + 1);
        if (rest) return { value: value + rest.value, next: rest.next };
        return { value, next };
      }
      const rest = readAmountPhrase(tokens, next);
      if (rest) return { value: value + rest.value, next: rest.next };
      return { value, next };
    }
  }

  // Bare "hundred" / "thousand"
  if (w === 'hundred') return { value: 100, next: i + 1 };
  if (w === 'thousand') return { value: 1000, next: i + 1 };

  return null;
}

/**
 * Compound EN/SW amounts. Words used in a compound are marked consumed so the
 * speech check does not also see atomic "100" + "3" beside a confirmed 300.
 */
function compoundNumbersIn(text) {
  const values = new Set();
  const consumed = new Set();
  const raw = numberReadingText(text);
  const tokens = [];
  let m;
  const re = new RegExp(TOKEN_RE.source, 'g');
  while ((m = re.exec(raw)) !== null) tokens.push(m[0]);

  let i = 0;
  while (i < tokens.length) {
    const w = String(tokens[i] || '').toLowerCase();
    const next = String(tokens[i + 1] || '').toLowerCase();
    const starts =
      w === 'mia' ||
      w === 'elfu' ||
      w === 'hundred' ||
      w === 'thousand' ||
      (wordVal(w) != null && (next === 'hundred' || next === 'thousand'));

    if (!starts) {
      i += 1;
      continue;
    }

    const phrase = readAmountPhrase(tokens, i);
    if (!phrase || phrase.next <= i) {
      i += 1;
      continue;
    }
    // A real compound uses a scale word, or at least two tokens.
    const span = phrase.next - i;
    const scaled =
      w === 'mia' ||
      w === 'elfu' ||
      w === 'hundred' ||
      w === 'thousand' ||
      next === 'hundred' ||
      next === 'thousand';
    if (!scaled && span < 2) {
      i += 1;
      continue;
    }
    if (phrase.value > 0) {
      values.add(String(phrase.value));
      for (let j = i; j < phrase.next; j += 1) consumed.add(j);
      i = phrase.next;
      continue;
    }
    i += 1;
  }
  return { values, consumed, tokens };
}

/** Every number a text states, as canonical digit strings. */
function numbersIn(text) {
  const out = new Set();
  const raw = numberReadingText(text);
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

  const compounds = compoundNumbersIn(raw);
  for (const v of compounds.values) out.add(v);

  // Atomic words that were not part of a compound ("tano", "five").
  let ti = 0;
  for (const hit of raw.matchAll(TOKEN_RE)) {
    const lower = hit[0].toLowerCase();
    if (!compounds.consumed.has(ti) && Object.prototype.hasOwnProperty.call(NUMBER_WORDS, lower)) {
      out.add(String(NUMBER_WORDS[lower]));
    }
    ti += 1;
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
  numberReadingText,
  quantityWord,
};
