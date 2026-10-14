'use strict';

// BRAIN_CALL_FIXES_D199 (HD_1677e57f73f9 1a): read a caller's Kiswahili clock.
// "leo saa 8:00" is saa nane, 14:00 or 02:00; without a period word it is
// ambiguous and Brain asks, never guesses. Swahili hour = Western hour + 6,
// mod 12: saa nane mchana = 14:00, saa tatu asubuhi = 09:00, saa mbili usiku =
// 20:00. Readings come from Voice's swahiliClock (#633) when it is on the
// branch, so speech and parsing share one table; the fallback here only reads
// the Swahili forms.

const HOUR_WORDS = [
  '', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita',
  'saba', 'nane', 'tisa', 'kumi', 'kumi na moja', 'kumi na mbili',
];
const WORD_HOUR = new Map(HOUR_WORDS.map((w, i) => [w, i]).filter(([w]) => w));

const PERIOD_RANGES = {
  alfajiri: [[3, 7]],
  asubuhi: [[6, 12]],
  mchana: [[12, 17]],
  alasiri: [[13, 18]],
  jioni: [[15, 20]],
  usiku: [[18, 24], [0, 6]],
};

const HOUR_TOKEN = '(\\d{1,2}|kumi na moja|kumi na mbili|moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|kumi)';
const MIN_TAIL = '(?:[:.](\\d{2})|\\s+na\\s+(nusu|robo))?';
const PERIOD = '(asubuhi|mchana|alasiri|jioni|usiku|alfajiri)';
// "saa 8", "saa 8:00", "saa nane na nusu", "saa nane (za|ya) mchana";
// a period may also lead: "kesho asubuhi saa tatu".
const SAA_CLOCK = new RegExp(
  `(?:\\b${PERIOD}\\s+(?:,\\s*)?)?\\bsaa\\s+${HOUR_TOKEN}\\b${MIN_TAIL}(?:\\s+(?:za\\s+|ya\\s+)?${PERIOD}\\b)?(?!\\s*(?:a\\.?m\\b|p\\.?m\\b|:\\d))`,
  'gi'
);

function voiceClock() {
  try {
    // eslint-disable-next-line global-require
    const mod = require('./swahiliClock');
    return mod && typeof mod.readSwahiliClock === 'function' ? mod : null;
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
    return null;
  }
}

function periodFits(period, minutes) {
  const ranges = PERIOD_RANGES[String(period || '').toLowerCase()];
  if (!ranges) return true;
  const h = Math.floor((((minutes % 1440) + 1440) % 1440) / 60);
  return ranges.some(([a, b]) => h >= a && h < b);
}

function hourNumber(token) {
  const raw = String(token || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^\d{1,2}$/.test(raw)) return Number(raw);
  return WORD_HOUR.has(raw) ? WORD_HOUR.get(raw) : null;
}

/** Minutes-since-midnight readings of "saa N[:MM] [period]". */
function readings(hourToken, minute = 0, period = '') {
  const clock = voiceClock();
  if (clock) return clock.readSwahiliClock(hourToken, minute, period || '').minutes || [];
  const n = hourNumber(hourToken);
  if (!(n >= 1 && n <= 12)) return [];
  const m = Math.max(0, Math.min(59, Number(minute) || 0));
  const swahili = [((n + 6) % 24) * 60 + m, ((n + 18) % 24) * 60 + m];
  if (!period) return swahili;
  return swahili.filter((v) => periodFits(period, v));
}

/**
 * Each "saa N" clock in text: { text, index, end, hour (Swahili 1..12),
 * minute, period, minutes[] }. One reading is a clock; two is ambiguous.
 */
function swahiliClockSpans(text) {
  const source = String(text || '');
  const out = [];
  SAA_CLOCK.lastIndex = 0;
  let match;
  while ((match = SAA_CLOCK.exec(source))) {
    const [full, leadPeriod, hourToken, mm, frac, trailPeriod] = match;
    const hour = hourNumber(hourToken);
    if (!(hour >= 1 && hour <= 12)) continue;
    const minute = mm != null ? Number(mm) : frac ? (frac.toLowerCase() === 'nusu' ? 30 : 15) : 0;
    if (minute > 59) continue;
    const period = String(trailPeriod || leadPeriod || '').toLowerCase();
    out.push({
      text: full,
      index: match.index,
      end: match.index + full.length,
      hour,
      minute,
      period,
      minutes: readings(hourToken, minute, period),
    });
  }
  return out;
}

/** "14:00" → "2 pm"; "14:30" → "2:30 pm"; 0 → "12 am"; 720 → "12 pm". */
function westernClockText(minutes) {
  const day = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(day / 60);
  const m = day % 60;
  const hour12 = ((h + 11) % 12) + 1;
  const ap = h >= 12 ? 'pm' : 'am';
  return m ? `${hour12}:${String(m).padStart(2, '0')} ${ap}` : `${hour12} ${ap}`;
}

/** Western 12h hour for a Swahili hour (saa nane → 2). */
function westernHour(swahiliHour) {
  const n = Number(swahiliHour);
  if (!(n >= 1 && n <= 12)) return null;
  return ((n + 6 - 1) % 12) + 1;
}

/**
 * Rewrite caller Kiswahili clocks for the when slot. A clock with one reading
 * becomes the Western form ("leo saa nane mchana" → "leo 2 pm"); a clock with
 * two readings is cut out and reported (ambiguous: { hour, westernHour,
 * minute }) so nothing parses "8:00" as 08:00.
 * @returns {{ text: string, changed: boolean, resolved: number|null, ambiguous: object|null }}
 */
function normalizeSwahiliClock(text) {
  const source = String(text || '');
  const spans = swahiliClockSpans(source);
  if (!spans.length) return { text: source, changed: false, resolved: null, ambiguous: null };
  let out = '';
  let at = 0;
  let resolved = null;
  let ambiguous = null;
  for (const span of spans) {
    out += source.slice(at, span.index);
    if (span.minutes.length === 1) {
      resolved = span.minutes[0];
      out += westernClockText(span.minutes[0]);
    } else {
      // Two readings: ask which. No reading fits the period: ask the time.
      ambiguous = {
        hour: span.hour,
        westernHour: span.minutes.length === 2 ? westernHour(span.hour) : null,
        minute: span.minute,
      };
    }
    at = span.end;
  }
  out += source.slice(at);
  return {
    text: out.replace(/\s+/g, ' ').replace(/\s+([,.?!])/g, '$1').trim(),
    changed: true,
    resolved,
    ambiguous: resolved == null ? ambiguous : null,
  };
}

/** "saa nane" / "saa nane na nusu" (no period) for a Swahili hour. */
function swahiliHourWords(hour, minute = 0) {
  const word = HOUR_WORDS[Number(hour)] || '';
  if (!word) return '';
  const tail = minute === 30 ? ' na nusu' : minute === 15 ? ' na robo' : '';
  return `saa ${word}${tail}`;
}

module.exports = {
  normalizeSwahiliClock,
  swahiliClockSpans,
  swahiliHourWords,
  westernClockText,
  westernHour,
};
