'use strict';

// VOICE_SW_TIME (default off): speak clock times the Swahili way.
// Swahili hours count from 6 AM / 6 PM: hour minus 6, mod 12 (9 AM -> saa tatu),
// with a period of day (asubuhi, mchana, jioni, usiku). HD_4ec204aafa93 heard
// "saa 9 asubuhi" for 9 AM, which a Swahili listener hears as 3 AM.

const HOUR_WORD = ['kumi na mbili', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa', 'kumi', 'kumi na moja'];
const UNIT = ['', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa'];

function swTimeEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.VOICE_SW_TIME || '').trim());
}

/** Period of day for a 24h hour: asubuhi 5-11, mchana 12-15, jioni 16-18, usiku 19-4. */
function swPeriod(hour24) {
  const h = ((hour24 % 24) + 24) % 24;
  if (h >= 5 && h < 12) return 'asubuhi';
  if (h >= 12 && h < 16) return 'mchana';
  if (h >= 16 && h < 19) return 'jioni';
  return 'usiku';
}

/** Swahili hour word for a 24h hour: (h - 6) mod 12, 0 -> kumi na mbili. */
function swHourWord(hour24) {
  return HOUR_WORD[((((hour24 - 6) % 12) + 12) % 12)];
}

function swMinuteWords(m) {
  if (m < 10) return UNIT[m];
  const tens = ['', 'kumi', 'ishirini', 'thelathini', 'arobaini', 'hamsini'][Math.floor(m / 10)];
  return m % 10 ? `${tens} na ${UNIT[m % 10]}` : tens;
}

/**
 * "saa tatu asubuhi", "saa tatu na nusu asubuhi", "saa tatu na robo asubuhi",
 * "saa nne kasorobo asubuhi" (9:45), "saa tatu na dakika kumi asubuhi".
 * @param {number} hour24 0-23
 * @param {number} [minute]
 * @param {{ period?: boolean }} [opts] period:false leaves the period word off (left side of a range)
 */
function speakSwClock(hour24, minute = 0, opts = {}) {
  let h = Number(hour24); let m = Number(minute) || 0;
  let clock;
  if (m === 45) { h += 1; clock = `saa ${swHourWord(h)} kasorobo`; } else {
    clock = `saa ${swHourWord(h)}`;
    if (m === 30) clock += ' na nusu';
    else if (m === 15) clock += ' na robo';
    else if (m) clock += ` na dakika ${swMinuteWords(m)}`;
  }
  return opts.period === false ? clock : `${clock} ${swPeriod(h)}`;
}

function to24(hour12, isPm) {
  const h = Number(hour12) % 12;
  return isPm ? h + 12 : h;
}

const PERIOD_RANGES = { asubuhi: [[5, 12]], mchana: [[12, 16]], alasiri: [[13, 17]], jioni: [[16, 20]], usiku: [[19, 24], [0, 5]], alfajiri: [[3, 7]] };
function fits(period, h24) { return (PERIOD_RANGES[period] || [[0, 24]]).some(([a, b]) => h24 >= a && h24 < b); }

/**
 * "9 asubuhi" / "saa 9 asubuhi" (digits + a Swahili period): the model writes western
 * digits; read it as a Swahili hour when that fits the period (2 asubuhi = 08:00,
 * 3 usiku = 21:00), else as the western hour (9 asubuhi = 09:00). Returns a 24h hour or null.
 */
function hour24FromDigitPeriod(hour, period) {
  const n = Number(hour); const p = String(period || '').toLowerCase();
  if (!(n >= 1 && n <= 12)) return null;
  // Swahili reading first ("saa 3 usiku" = 21:00, "saa 2 asubuhi" = 08:00); western
  // when the Swahili hour cannot be in that period ("saa 9 asubuhi" = 09:00).
  const swahili = [(n + 6) % 24, (n + 18) % 24].filter((h) => fits(p, h));
  if (swahili.length) return swahili[0];
  const western = [n % 12, (n % 12) + 12].filter((h) => fits(p, h));
  return western.length ? western[0] : null;
}

module.exports = { swTimeEnabled, swPeriod, swHourWord, speakSwClock, to24, hour24FromDigitPeriod };
