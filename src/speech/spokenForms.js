// Language-aware spoken forms for money, times, day ranges, and phones.

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
  return String(num);
}

function speakAmount(amount, lang) {
  const whole = Math.floor(amount);
  if (lang === 'sw') {
    return `shilingi ${numberToSw(whole)}`;
  }
  return `${numberToEn(whole)} shillings`;
}

/**
 * Expand KES / Ksh / bob money amounts into spoken words.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandMoney(text, lang = 'en') {
  let out = String(text || '');
  const ttsLang = lang === 'sw' ? 'sw' : 'en';

  out = out.replace(
    /\b(?:kes|ksh|kshs|sh)\.?\s*([\d,]+(?:\.\d{1,2})?)\b/gi,
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
 * Expand clock times like 3pm / 3:30 a.m.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandTimes(text, lang = 'en') {
  let out = String(text || '');
  const ttsLang = lang === 'sw' ? 'sw' : 'en';

  out = out.replace(
    /\b(saa\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi,
    (full, saaPrefix, h, m, mer) => {
      const hour = Number(h);
      const mins = m != null ? Number(m) : null;
      const isPm = /^p/i.test(mer);
      if (ttsLang === 'sw') {
        // Keep hour numeral + clear period; full Swahili clock mapping is easy to get wrong.
        const period = isPm ? 'jioni' : 'asubuhi';
        const head = 'saa';
        if (mins && mins !== 0) {
          return `${head} ${hour} na dakika ${mins} ${period}`;
        }
        return `${head} ${hour} ${period}`;
      }
      const period = isPm ? 'P M' : 'A M';
      if (mins != null && mins !== 0) {
        return `${hour} ${String(mins).padStart(2, '0')} ${period}`;
      }
      return `${hour} ${period}`;
    }
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
 * Expand phone-ish digit runs digit-by-digit (works for EN and SW TTS).
 * Handles +254… and bare 07xxxxxxxx Kenyan mobiles.
 * @param {string} text
 */
function expandPhones(text) {
  let out = String(text || '');

  out = out.replace(/\+(\d[\d\s-]{7,}\d)/g, (_, digits) => {
    const d = String(digits).replace(/\D/g, '');
    return d.split('').join(' ');
  });

  out = out.replace(/\b(0[71]\d{8})\b/g, (_, digits) => digits.split('').join(' '));

  return out;
}

/**
 * Apply money → time → day-range spoken forms.
 * @param {string} text
 * @param {'en'|'sw'|string} lang
 */
function expandSpokenForms(text, lang = 'en') {
  let out = String(text || '');
  out = expandMoney(out, lang);
  out = expandTimes(out, lang);
  out = expandDayRanges(out, lang);
  return out;
}

module.exports = {
  expandMoney,
  expandTimes,
  expandDayRanges,
  expandPhones,
  expandSpokenForms,
  numberToEn,
  numberToSw,
  speakAmount,
};
