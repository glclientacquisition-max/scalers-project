'use strict';

// Kiswahili clock. The Swahili day starts at sunrise (06:00 = saa kumi na
// mbili asubuhi, 07:00 = saa moja asubuhi), so the spoken hour is the
// 24-hour clock minus 6, mod 12. HD_d199dbbf6b79 spoke 09:00 EAT as
// "saa 9 asubuhi"; the right form is "saa tatu asubuhi".
//
// One helper for every place a time is spoken in Kiswahili: tool
// confirmations, visit reads, the TTS normaliser, and the guard that checks a
// model-written Swahili time against the stored time.

const HOUR_WORDS = [
  '', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita',
  'saba', 'nane', 'tisa', 'kumi', 'kumi na moja', 'kumi na mbili',
];
const UNITS = ['', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa'];
const TENS = { 1: 'kumi', 2: 'ishirini', 3: 'thelathini', 4: 'arobaini', 5: 'hamsini' };

/** 1..59 in Kiswahili words. */
function minuteWords(n) {
  const value = Math.floor(Number(n));
  if (!(value >= 1 && value <= 59)) return '';
  const tens = Math.floor(value / 10);
  const unit = value % 10;
  if (!tens) return UNITS[unit];
  return unit ? `${TENS[tens]} na ${UNITS[unit]}` : TENS[tens];
}

/** Period for a 24h hour: asubuhi 06-11, mchana 12-15, jioni 16-19, usiku 20-05. */
function swahiliPeriod(hour24) {
  const h = ((Math.floor(Number(hour24)) % 24) + 24) % 24;
  if (h >= 6 && h < 12) return 'asubuhi';
  if (h >= 12 && h < 16) return 'mchana';
  if (h >= 16 && h < 20) return 'jioni';
  return 'usiku';
}

/** Swahili hour number 1..12 for a 24h hour. */
function swahiliHour(hour24) {
  const n = (((Math.floor(Number(hour24)) - 6) % 12) + 12) % 12;
  return n === 0 ? 12 : n;
}

/**
 * Minutes since midnight (EAT) → "saa tatu asubuhi", "saa tatu na nusu
 * asubuhi", "saa tatu na robo asubuhi", "saa nne kasoro robo asubuhi",
 * "saa tatu na dakika kumi asubuhi", "saa nne kasoro dakika tano asubuhi".
 * @param {number} minutesSinceMidnight
 * @param {{ period?: boolean }} [opts] period: false drops the period word.
 * @returns {string}
 */
function swahiliClock(minutesSinceMidnight, opts = {}) {
  const total = Math.round(Number(minutesSinceMidnight));
  if (!Number.isFinite(total)) return '';
  const day = ((total % 1440) + 1440) % 1440;
  const actualHour = Math.floor(day / 60);
  let hour24 = actualHour;
  const min = day % 60;
  let tail = '';
  if (min === 15) tail = ' na robo';
  else if (min === 30) tail = ' na nusu';
  else if (min === 45) {
    hour24 = (hour24 + 1) % 24;
    tail = ' kasoro robo';
  } else if (min > 0 && min < 30) tail = ` na dakika ${minuteWords(min)}`;
  else if (min > 30) {
    hour24 = (hour24 + 1) % 24;
    tail = ` kasoro dakika ${minuteWords(60 - min)}`;
  }
  // The period is the actual time of day: 11:45 is "saa sita kasoro robo asubuhi".
  const period = opts.period === false ? '' : ` ${swahiliPeriod(actualHour)}`;
  return `saa ${HOUR_WORDS[swahiliHour(hour24)]}${tail}${period}`;
}

const PERIOD_RANGES = {
  // Lenient hour ranges a period word can describe (24h, end exclusive).
  alfajiri: [[3, 7]],
  asubuhi: [[6, 12]],
  mchana: [[12, 17]],
  alasiri: [[13, 18]],
  jioni: [[15, 20]],
  usiku: [[18, 24], [0, 6]],
};

function periodFits(period, minutes) {
  const ranges = PERIOD_RANGES[String(period || '').toLowerCase()];
  if (!ranges) return true;
  const h = Math.floor((((minutes % 1440) + 1440) % 1440) / 60);
  return ranges.some(([a, b]) => h >= a && h < b);
}

const WORD_HOUR = new Map(HOUR_WORDS.map((w, i) => [w, i]).filter(([w]) => w));

function hourNumber(token) {
  const raw = String(token || '').trim().toLowerCase();
  if (/^\d{1,2}$/.test(raw)) return Number(raw);
  return WORD_HOUR.has(raw) ? WORD_HOUR.get(raw) : null;
}

/**
 * Readings of a spoken Swahili clock phrase, best first.
 * Swahili reading: saa N = N+6 or N+18. A Western numeral slip ("saa 9
 * asubuhi" for 09:00) is a fallback only when no Swahili reading fits the
 * period word.
 * @returns {{ minutes: number[], western: boolean }}
 */
function readSwahiliClock(hourToken, minutes = 0, period = '') {
  const n = hourNumber(hourToken);
  if (!(n >= 1 && n <= 12)) return { minutes: [], western: false };
  const m = Math.max(0, Math.min(59, Number(minutes) || 0));
  const swahili = [((n + 6) % 24) * 60 + m, ((n + 18) % 24) * 60 + m];
  const fitsSw = swahili.filter((v) => periodFits(period, v));
  if (fitsSw.length) return { minutes: period ? fitsSw : swahili, western: false };
  const western = [(n % 12) * 60 + m, ((n % 12) + 12) * 60 + m].filter((v) => periodFits(period, v));
  return western.length ? { minutes: western, western: true } : { minutes: [], western: false };
}

const HOUR_TOKEN = '(\\d{1,2}|kumi na moja|kumi na mbili|moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi)';
const MIN_TAIL = '(?::(\\d{2})|\\s+na\\s+(nusu|robo)|\\s+na\\s+dakika\\s+(\\d{1,2}))?';
const PERIOD = '(asubuhi|mchana|alasiri|jioni|usiku|alfajiri)';
// "saa 9 asubuhi", "saa tatu na nusu asubuhi", "saa 3:30 usiku", "9 asubuhi".
const CLOCK_PHRASE = new RegExp(`\\b(saa\\s+)?${HOUR_TOKEN}${MIN_TAIL}\\s+${PERIOD}\\b`, 'gi');

function phraseMinutes(min, frac, dak) {
  if (min != null) return Number(min);
  if (frac) return frac.toLowerCase() === 'nusu' ? 30 : 15;
  if (dak != null) return Number(dak);
  return 0;
}

/** Each Swahili clock phrase in text, with its readings. */
function swahiliClockPhrases(text) {
  const out = [];
  const source = String(text || '');
  CLOCK_PHRASE.lastIndex = 0;
  let match;
  while ((match = CLOCK_PHRASE.exec(source))) {
    const [full, saa, hour, min, frac, dak, period] = match;
    // A bare numeral with no "saa" needs the numeral form ("9 asubuhi").
    if (!saa && !/^\d/.test(hour)) continue;
    const reading = readSwahiliClock(hour, phraseMinutes(min, frac, dak), period);
    out.push({ text: full, index: match.index, period: period.toLowerCase(), ...reading });
  }
  return out;
}

/**
 * Rewrite numeric or wrong Swahili clock phrases to the spoken Kiswahili
 * form: "saa 9 asubuhi" → "saa tatu asubuhi", "saa 3:00 usiku" → "saa tatu
 * usiku". A phrase that fits no reading is left as written.
 */
function normalizeSwahiliClockText(text) {
  return String(text || '').replace(CLOCK_PHRASE, (full, saa, hour, min, frac, dak, period) => {
    if (!saa && !/^\d/.test(hour)) return full;
    const reading = readSwahiliClock(hour, phraseMinutes(min, frac, dak), period);
    if (!reading.minutes.length) return full;
    // Spoken with the period of the actual time; alfajiri / alasiri stay.
    const value = reading.minutes[0];
    const p = period.toLowerCase();
    if (p !== 'alfajiri' && p !== 'alasiri') return swahiliClock(value);
    return `${swahiliClock(value, { period: false })} ${p}`;
  });
}

/**
 * Compare Swahili clock phrases with stored times (minutes since midnight).
 * A phrase whose readings include a stored time is rewritten to that stored
 * time; a phrase that matches none is reported.
 * @returns {{ text: string, mismatches: Array<{ said: string, stored: number[] }> }}
 */
function reconcileSwahiliTimes(text, storedMinutes = []) {
  const stored = [...new Set((storedMinutes || []).filter((v) => Number.isFinite(v)).map((v) => ((Math.round(v) % 1440) + 1440) % 1440))];
  const mismatches = [];
  if (!stored.length) return { text: String(text || ''), mismatches };
  const out = String(text || '').replace(CLOCK_PHRASE, (full, saa, hour, min, frac, dak, period) => {
    if (!saa && !/^\d/.test(hour)) return full;
    const reading = readSwahiliClock(hour, phraseMinutes(min, frac, dak), period);
    // Only readings that fit the period word: "saa tisa mchana" (15:00) is
    // never bent to a stored 09:00, while "saa 9 asubuhi" (a Western slip
    // for 09:00) is.
    const all = new Set(reading.minutes);
    const hit = stored.find((v) => all.has(v));
    if (hit != null) return swahiliClock(hit);
    mismatches.push({ said: full, stored });
    return full;
  });
  return { text: out, mismatches };
}

module.exports = {
  swahiliClock,
  swahiliHour,
  swahiliPeriod,
  minuteWords,
  readSwahiliClock,
  swahiliClockPhrases,
  normalizeSwahiliClockText,
  reconcileSwahiliTimes,
};
