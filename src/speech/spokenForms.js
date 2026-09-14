// Language-aware spoken forms for money, times, day ranges, and phones.

const { minutesToHour12 } = require('../conversation/appointmentHours');

const EN_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

const SW_ONES = [
  'sifuri',
  'moja',
  'mbili',
  'tatu',
  'nne',
  'tano',
  'sita',
  'saba',
  'nane',
  'tisa',
];
const SW_TENS = [
  '',
  'kumi',
  'ishirini',
  'thelathini',
  'arobaini',
  'hamsini',
  'sitini',
  'sabini',
  'themanini',
  'tisini',
];

const DAY_MAP_EN = {
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
  sat: 'Saturday',
  saturday: 'Saturday',
  sun: 'Sunday',
  sunday: 'Sunday',
};

const DAY_MAP_SW = {
  mon: 'Jumatatu',
  monday: 'Jumatatu',
  tue: 'Jumanne',
  tues: 'Jumanne',
  tuesday: 'Jumanne',
  wed: 'Jumatano',
  wednesday: 'Jumatano',
  thu: 'Alhamisi',
  thur: 'Alhamisi',
  thurs: 'Alhamisi',
  thursday: 'Alhamisi',
  fri: 'Ijumaa',
  friday: 'Ijumaa',
  sat: 'Jumamosi',
  saturday: 'Jumamosi',
  sun: 'Jumapili',
  sunday: 'Jumapili',
};

function parseAmount(raw) {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function numberToEn(n) {
  const num = Math.floor(Math.abs(n));
  if (num < 20) return EN_ONES[num];
  if (num < 100) {
    const t = Math.floor(num / 10);
    const o = num % 10;
    return o ? `${EN_TENS[t]} ${EN_ONES[o]}` : EN_TENS[t];
  }
  if (num < 1000) {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    return rest
      ? `${EN_ONES[h]} hundred ${numberToEn(rest)}`
      : `${EN_ONES[h]} hundred`;
  }
  if (num < 1000000) {
    const th = Math.floor(num / 1000);
    const rest = num % 1000;
    const head = `${numberToEn(th)} thousand`;
    return rest ? `${head} ${numberToEn(rest)}` : head;
  }
  if (num < 1000000000) {
    const m = Math.floor(num / 1000000);
    const rest = num % 1000000;
    const head = `${numberToEn(m)} million`;
    return rest ? `${head} ${numberToEn(rest)}` : head;
  }
  return String(num);
}

function numberToSwUnder100(n) {
  if (n < 10) return SW_ONES[n];
  if (n === 10) return 'kumi';
  if (n < 20) return `kumi na ${SW_ONES[n - 10]}`;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${SW_TENS[t]} na ${SW_ONES[o]}` : SW_TENS[t];
}

function numberToSw(n) {
  const num = Math.floor(Math.abs(n));
  if (num < 100) return numberToSwUnder100(num);
  if (num < 1000) {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    const head = h === 1 ? 'mia moja' : `mia ${SW_ONES[h]}`;
    return rest ? `${head} ${numberToSwUnder100(rest)}` : head;
  }
  if (num < 1000000) {
    const th = Math.floor(num / 1000);
    const rest = num % 1000;
    let head;
    if (th === 1) head = 'elfu moja';
    else if (th < 100) head = `elfu ${numberToSwUnder100(th)}`;
    else head = `elfu ${numberToSw(th)}`;
    if (!rest) return head;
    if (rest < 100) return `${head} ${numberToSwUnder100(rest)}`;
    return `${head} ${numberToSw(rest)}`;
  }
  if (num < 1000000000) {
    const m = Math.floor(num / 1000000);
    const rest = num % 1000000;
    const head = `milioni ${numberToSw(m)}`;
    return rest ? `${head} ${numberToSw(rest)}` : head;
  }
  return String(num);
}

const MONEY_UNITS = {
  kes: { en: 'shillings', sw: 'shilingi' },
  usd: { en: 'dollars', sw: 'dola' },
};

/**
 * Speak an amount with its currency unit. Cents are spoken when present:
 * M-Pesa payments need the exact figure, so 1,200.50 is never truncated.
 */
function speakMoney(amount, lang, unit = 'kes') {
  const u = MONEY_UNITS[unit] || MONEY_UNITS.kes;
  const whole = Math.floor(amount);
  const cents = Math.round((amount - whole) * 100);
  if (lang === 'sw') {
    const parts = [];
    if (whole > 0) parts.push(`${u.sw} ${numberToSw(whole)}`);
    if (cents > 0) parts.push(`senti ${numberToSw(cents)}`);
    return parts.join(' na ') || `${u.sw} sifuri`;
  }
  const parts = [];
  if (whole > 0) parts.push(`${numberToEn(whole)} ${u.en}`);
  if (cents > 0) parts.push(`${numberToEn(cents)} cents`);
  return parts.join(' and ') || `zero ${u.en}`;
}

function speakAmount(amount, lang) {
  return speakMoney(amount, lang, 'kes');
}

function speakNumber(amount, lang) {
  const whole = Math.floor(amount);
  return lang === 'sw' ? numberToSw(whole) : numberToEn(whole);
}

function rangeJoiner(lang) {
  return lang === 'sw' ? 'hadi' : 'to';
}

function formatAmountRange(rawA, rawB, lang, withUnit) {
  const a = parseAmount(rawA);
  const b = parseAmount(rawB);
  if (a == null || b == null) return null;
  const joiner = rangeJoiner(lang);
  if (withUnit) {
    return `${speakAmount(a, lang)} ${joiner} ${speakAmount(b, lang)}`;
  }
  return `${speakNumber(a, lang)} ${joiner} ${speakNumber(b, lang)}`;
}

const AMOUNT_CAPTURE = '([\\d,]+(?:\\.\\d{1,2})?)';
const RANGE_DASH = '(?:\\s*[-–—]\\s*|\\s+(?:to|hadi)\\s+)';
const KES_PREFIX = '(?:kes|kshs|ksh|shillings?|sh)';

/**
 * Kenyan shorthand thousands: 50k → 50000, 1.5k → 1500.
 * Rewrites to digits so downstream money rules can claim them (KES 5k).
 * Guards block 5km / 10kg.
 * @param {string} text
 */
function expandKThousands(text) {
  return String(text || '').replace(/\b(\d+(?:\.\d+)?)k(?!\w)/gi, (full, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return full;
    return String(Math.round(n * 1000));
  });
}

/**
 * Expand KES / Ksh / bob money amounts into spoken words.
 * Range forms run first so both sides convert (KSh 500-800).
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandMoney(text, lang = 'en') {
  let out = String(text || '');
  const ttsLang = lang === 'sw' ? 'sw' : 'en';

  // Prefix range: KSh 500-800 / KES 1,500–2,000/= / KSh 500 to 800
  out = out.replace(
    new RegExp(
      `\\b${KES_PREFIX}\\.?\\s*${AMOUNT_CAPTURE}${RANGE_DASH}${AMOUNT_CAPTURE}(?:\\s*(?:kes|ksh|kshs|bob|shillings?)|\\/[=-])?`,
      'gi'
    ),
    (full, a, b) => formatAmountRange(a, b, ttsLang, true) || full
  );

  // Suffix range: 500-800 bob / 1,500-2,000 shillings / 500 to 800 bob
  out = out.replace(
    new RegExp(
      `\\b${AMOUNT_CAPTURE}${RANGE_DASH}${AMOUNT_CAPTURE}\\s*(?:kes|ksh|kshs|bob|shillings?)\\b`,
      'gi'
    ),
    (full, a, b) => formatAmountRange(a, b, ttsLang, true) || full
  );

  // Receipt-range: 500-800/= or 500-800/- (optional currency prefix)
  out = out.replace(
    new RegExp(
      `\\b(?:${KES_PREFIX}\\.?\\s*)?${AMOUNT_CAPTURE}${RANGE_DASH}${AMOUNT_CAPTURE}\\/[=-](?!\\w)`,
      'gi'
    ),
    (full, a, b) => formatAmountRange(a, b, ttsLang, true) || full
  );

  // Receipt shorthand: 1500/= or 500/- (optional currency prefix so
  // "KSh 500/-" never strands a spelled-out "KSh" before the words)
  out = out.replace(
    new RegExp(`\\b(?:${KES_PREFIX}\\.?\\s*)?${AMOUNT_CAPTURE}\\/[=-](?!\\w)`, 'gi'),
    (full, raw) => {
      const amount = parseAmount(raw);
      return amount == null ? full : speakAmount(amount, ttsLang);
    }
  );

  // USD prefix: USD 100 / US$100 / $100
  // ($ is non-word so \b cannot guard it; the digit capture anchors the match)
  out = out.replace(
    /(?:\busd\b|\bus\$|\$)\s*([\d,]+(?:\.\d{1,2})?)\b/gi,
    (full, raw) => {
      const amount = parseAmount(raw);
      return amount == null ? full : speakMoney(amount, ttsLang, 'usd');
    }
  );

  // USD suffix: 100 dollars
  out = out.replace(
    /\b([\d,]+(?:\.\d{1,2})?)\s*(?:us\s*)?dollars?\b/gi,
    (full, raw) => {
      const amount = parseAmount(raw);
      return amount == null ? full : speakMoney(amount, ttsLang, 'usd');
    }
  );

  out = out.replace(
    new RegExp(`\\b${KES_PREFIX}\\.?\\s*([\\d,]+(?:\\.\\d{1,2})?)\\b`, 'gi'),
    (full, raw) => {
      const amount = parseAmount(raw);
      return amount == null ? full : speakAmount(amount, ttsLang);
    }
  );

  out = out.replace(
    /\b([\d,]+(?:\.\d{1,2})?)\s*(?:kes|ksh|kshs|bob|shillings?)\b/gi,
    (full, raw) => {
      const amount = parseAmount(raw);
      return amount == null ? full : speakAmount(amount, ttsLang);
    }
  );

  return out;
}

/**
 * Convert catalog `Price: 15,000` numbers to words. Does not add a currency
 * unit and does not touch quantities elsewhere in the sentence.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandBarePriceInContext(text, lang = 'en') {
  const ttsLang = lang === 'sw' ? 'sw' : 'en';
  return String(text || '').replace(
    new RegExp(
      `\\b(price:\\s*)${AMOUNT_CAPTURE}(?:${RANGE_DASH}${AMOUNT_CAPTURE})?`,
      'gi'
    ),
    (full, label, rawA, rawB) => {
      if (rawB) {
        const spoken = formatAmountRange(rawA, rawB, ttsLang, false);
        return spoken ? `${label}${spoken}` : full;
      }
      const amount = parseAmount(rawA);
      return amount == null ? full : `${label}${speakNumber(amount, ttsLang)}`;
    }
  );
}

function speak12hTime(hour, mins, isPm, lang) {
  if (lang === 'sw') {
    // Keep hour numeral + clear period; full Swahili clock mapping is easy to get wrong.
    const period = isPm ? 'jioni' : 'asubuhi';
    if (mins && mins !== 0) {
      return `saa ${hour} na dakika ${mins} ${period}`;
    }
    return `saa ${hour} ${period}`;
  }
  const period = isPm ? 'P M' : 'A M';
  if (mins != null && mins !== 0) {
    return `${hour} ${String(mins).padStart(2, '0')} ${period}`;
  }
  return `${hour} ${period}`;
}

const MERIDIEM = '(a\\.?m\\.?|p\\.?m\\.?)';

/**
 * Expand 12-hour clock ranges like 3pm-4pm / 3:00 p.m. - 4:30 p.m. / 3-4pm.
 * Runs before expandTimes so the dash between two times is never left for TTS.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandTimeRanges12h(text, lang = 'en') {
  let out = String(text || '');
  const ttsLang = lang === 'sw' ? 'sw' : 'en';
  const joiner = rangeJoiner(ttsLang);

  out = out.replace(
    new RegExp(
      `\\b(saa\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}\\s*[-–—]\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}\\b`,
      'gi'
    ),
    (full, saaPrefix, h1, m1, mer1, h2, m2, mer2) => {
      let left = speak12hTime(
        Number(h1),
        m1 != null ? Number(m1) : null,
        /^p/i.test(mer1),
        ttsLang
      );
      const right = speak12hTime(
        Number(h2),
        m2 != null ? Number(m2) : null,
        /^p/i.test(mer2),
        ttsLang
      );
      if (saaPrefix) left = left.replace(/^saa\s+/, '');
      return `${saaPrefix || ''}${left} ${joiner} ${right}`;
    }
  );

  // Shared meridiem: 3-4pm. Only the right side carries the period.
  out = out.replace(
    new RegExp(
      `\\b(saa\\s+)?(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}\\b`,
      'gi'
    ),
    (full, saaPrefix, h1, h2, m2, mer2) => {
      const right = speak12hTime(
        Number(h2),
        m2 != null ? Number(m2) : null,
        /^p/i.test(mer2),
        ttsLang
      );
      const left = ttsLang === 'sw' ? `saa ${Number(h1)}` : String(Number(h1));
      if (saaPrefix) return `${saaPrefix}${left.replace(/^saa\s+/, '')} ${joiner} ${right}`;
      return `${left} ${joiner} ${right}`;
    }
  );

  return out;
}

/**
 * Expand clock times like 3pm / 3:30 a.m.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandTimes(text, lang = 'en') {
  let out = String(text || '');
  const ttsLang = lang === 'sw' ? 'sw' : 'en';

  out = out.replace(
    /\b(saa\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi,
    (full, saaPrefix, h, m, mer) =>
      speak12hTime(Number(h), m != null ? Number(m) : null, /^p/i.test(mer), ttsLang)
  );

  return out;
}

const TIME_24 = '([01]?\\d|2[0-3]):([0-5]\\d)';
const NOT_MERIDIEM = '(?!\\s*(?:a\\.?m\\.?|p\\.?m\\.?))';

function speak24hClock(hour24, minute, lang) {
  const label = minutesToHour12(hour24 * 60 + minute);
  if (lang !== 'sw') return label;
  const parsed = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/.exec(label);
  if (!parsed) return label;
  const hour12 = Number(parsed[1]);
  const mins = parsed[2] ? Number(parsed[2]) : 0;
  const period = parsed[3] === 'PM' ? 'jioni' : 'asubuhi';
  if (mins) return `saa ${hour12} na dakika ${mins} ${period}`;
  return `saa ${hour12} ${period}`;
}

/**
 * Safety net for bare 24-hour clocks the model did not paraphrase.
 * Skips times that already have an AM/PM marker (those stay on expandTimes).
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expand24HourTime(text, lang = 'en') {
  let out = String(text || '');
  const ttsLang = lang === 'sw' ? 'sw' : 'en';
  const joiner = rangeJoiner(ttsLang);

  out = out.replace(
    new RegExp(`\\b${TIME_24}\\s*[-–—]\\s*${TIME_24}${NOT_MERIDIEM}\\b`, 'gi'),
    (full, h1, m1, h2, m2) =>
      `${speak24hClock(Number(h1), Number(m1), ttsLang)} ${joiner} ${speak24hClock(Number(h2), Number(m2), ttsLang)}`
  );

  out = out.replace(
    new RegExp(`\\b${TIME_24}${NOT_MERIDIEM}\\b`, 'gi'),
    (full, h, m) => speak24hClock(Number(h), Number(m), ttsLang)
  );

  return out;
}

/**
 * Expand day ranges like Mon-Sat / Monday–Saturday.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandDayRanges(text, lang = 'en') {
  const map = lang === 'sw' ? DAY_MAP_SW : DAY_MAP_EN;
  const joiner = lang === 'sw' ? 'hadi' : 'to';

  return String(text || '').replace(
    /\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*[-–—]\s*(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
    (_, a, b) => {
      const left = map[String(a).toLowerCase()] || a;
      const right = map[String(b).toLowerCase()] || b;
      return `${left} ${joiner} ${right}`;
    }
  );
}

/**
 * Identifier-style digit runs (till, paybill, account, order, reference, code)
 * must read digit-by-digit, not as one giant number. Strong keywords accept
 * 4+ digits; weak ones (till / number / no) need 5+ so "open till 2026"
 * stays a year.
 * @param {string} text
 */
function expandIdentifiers(text) {
  let out = String(text || '');
  const speakDigits = (run) => {
    const digits = String(run).replace(/\D/g, '');
    return digits.split('').join(' ');
  };

  out = out.replace(
    /\b(?:order|reference|ref|code|account|a\/c|pay\s?bill)\.?\s*(?:number|no\.?|#)?\s*[:#]?\s*(\d[\d\s\u2013\u2014-]{2,}\d)/gi,
    (full, run) => {
      const digits = String(run).replace(/\D/g, '');
      if (digits.length < 4 || digits.length > 16) return full;
      return full.replace(run, speakDigits(run));
    }
  );

  out = out.replace(
    /\b(?:till|number|no)\.?\s*(?:number|no\.?|#)?\s*[:#]?\s*(\d[\d\s\u2013\u2014-]{3,}\d)/gi,
    (full, run) => {
      const digits = String(run).replace(/\D/g, '');
      if (digits.length < 5 || digits.length > 16) return full;
      return full.replace(run, speakDigits(run));
    }
  );

  // "open 24/7" reads as "twenty four seven", never "slash".
  out = out.replace(/\b24\s*\/\s*7\b/g, '24 7');

  return out;
}

/**
 * Compact digit ranges with a unit word: 30-40 minutes, 1-2 days, 2-3 seaters.
 * Money, clock, and day ranges are claimed earlier in the pipeline.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandNumberUnitRanges(text, lang = 'en') {
  const joiner = rangeJoiner(lang === 'sw' ? 'sw' : 'en');
  return String(text || '').replace(
    /\b(\d{1,3})\s*[-–—]\s*(\d{1,3})\s+(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|seaters?|units?|items?|km|kg|people|pax|guests?)\b/gi,
    (full, a, b, unit) => `${a} ${joiner} ${b} ${unit}`
  );
}

/**
 * Expand phone-ish digit runs digit-by-digit (works for EN and SW TTS).
 * Handles +254…, compact 07/01xxxxxxxx, and spaced/hyphenated local mobiles.
 * @param {string} text
 */
function expandPhones(text) {
  let out = String(text || '');

  out = out.replace(/\+(\d[\d\s-]{7,}\d)/g, (_, digits) => {
    const d = String(digits).replace(/\D/g, '');
    return d.split('').join(' ');
  });

  out = out.replace(/\b(0[71]\d{8})\b/g, (_, digits) => digits.split('').join(' '));

  out = out.replace(/\b(0[71](?:[\s-]*\d){8})\b/g, (full) => {
    const d = String(full).replace(/\D/g, '');
    if (!/^0[71]\d{8}$/.test(d)) return full;
    return d.split('').join(' ');
  });

  return out;
}

/**
 * Apply 12h time ranges → money → catalog Price: numbers → AM/PM times → 24h safety net → day ranges.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandSpokenForms(text, lang = 'en') {
  let out = String(text || '');
  out = expandTimeRanges12h(out, lang);
  out = expandKThousands(out);
  out = expandMoney(out, lang);
  out = expandBarePriceInContext(out, lang);
  out = expandIdentifiers(out);
  out = expandNumberUnitRanges(out, lang);
  out = expandTimes(out, lang);
  out = expand24HourTime(out, lang);
  out = expandDayRanges(out, lang);
  return out;
}

module.exports = {
  expandMoney,
  expandBarePriceInContext,
  expandKThousands,
  expandTimeRanges12h,
  expandIdentifiers,
  expandNumberUnitRanges,
  expandTimes,
  expand24HourTime,
  expandDayRanges,
  expandPhones,
  expandSpokenForms,
  numberToEn,
  numberToSw,
  speakAmount,
  speakMoney,
};
