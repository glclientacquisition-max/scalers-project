// Visit time completeness. A day is not a time. The appointment tool needs a
// clock or a period (morning, afternoon). Ask for it before the tool, never
// after a failed tool. Two asks without a time waives the slot to a callback
// note so the caller is not looped.

const { resolveAppointmentWhen } = require('./appointmentHours');
const { entityValue } = require('./entityExtraction');
const { confirmationLanguage } = require('./language');

const DAY_CUE =
  /\b(today|tomorrow|tonight|leo|kesho|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili)\b/i;

const PERIOD_ANSWER = /\b(morning|asubuhi|afternoon|mchana|evening|jioni|noon|midday|saa sita)\b/i;
const BARE_HOUR = /(?:^|\b(?:at|saa|around|by)\s+)(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:a\.?m|p\.?m|:\d|\s*(?:diaries|books|pieces|kg|k\b)))/i;

function clockPhrase(text) {
  const hit = String(text || '').match(/\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/i);
  if (hit) return hit[0].replace(/[\s.]/g, '').toLowerCase();
  // BRAIN_CALL_FIXES_D199 (HD_1677e57f73f9 1a): "saa nane mchana" is 2pm.
  const sw = swahiliClockOf(text);
  if (sw.resolved == null) return '';
  const western = require('./swahiliClockParse').westernClockText(sw.resolved);
  return western.replace(/\s/g, '');
}

function swahiliClockOf(text) {
  if (!require('./callFixesD199').callFixesD199Enabled()) return { changed: false, resolved: null, ambiguous: null };
  return require('./swahiliClockParse').normalizeSwahiliClock(text);
}

/** BRAIN_CALL_FIXES_D199: Western hour of an ambiguous "saa 8" (2), else null. */
function swahiliPendingHourOf(text) {
  const sw = swahiliClockOf(text);
  return sw.resolved == null && sw.ambiguous ? sw.ambiguous.westernHour : null;
}

function whenValue(state) {
  return String(entityValue(state?.entities?.when) || '').trim();
}

function whenHasClockTime(when) {
  const raw = String(when || '').trim();
  if (!raw) return false;
  return Boolean(resolveAppointmentWhen(raw).ok);
}

function dayCue(when) {
  const hit = DAY_CUE.exec(String(when || ''));
  return hit ? hit[1].toLowerCase() : '';
}

function isHomeVisitState(state, profile = {}) {
  const vertical = String(profile?.vertical || state?.vertical || '').toLowerCase();
  return vertical === 'home_services' && String(state?.intent || '') === 'booking';
}

/** True when the visit has a day but no usable time and the caller has not been waived. */
function whenNeedsClockTime(state, profile = {}) {
  if (!isHomeVisitState(state, profile)) return false;
  if (state?.conversation?.timeWaived) return false;
  const when = whenValue(state);
  if (!when || !dayCue(when)) return false;
  return !whenHasClockTime(when);
}

function timeAskCount(state) {
  return (state?.conversation?.questionsAsked || []).filter((slot) => slot === 'time').length;
}

const PERIOD_HOURS = {
  alfajiri: [[3, 7]],
  asubuhi: [[6, 12]],
  mchana: [[12, 17]],
  alasiri: [[13, 18]],
  jioni: [[15, 20]],
  usiku: [[18, 24], [0, 6]],
};

function periodFitsWord(period, minutes) {
  const ranges = PERIOD_HOURS[String(period || '').toLowerCase()] || [];
  const h = Math.floor((((minutes % 1440) + 1440) % 1440) / 60);
  return ranges.some(([a, b]) => h >= a && h < b);
}

function hourWord(hour) {
  return String(hour);
}

/**
 * Fold a caller answer to a time ask into the when slot.
 * "12" alone is pending until morning/afternoon/noon confirms it.
 */
function mergeTimeAnswer({ when = '', pendingHour = null, text = '' } = {}) {
  const raw = String(text || '').trim();
  const day = dayCue(when) || dayCue(raw) || '';
  if (!raw) return { when, pendingHour, changed: false };
  // BRAIN_CALL_FIXES_D199 (1a): "saa nane" is Western 2, not 8; with a period
  // it is a clock, without one it is pending until asubuhi/mchana/usiku.
  const sw = swahiliClockOf(raw);
  if (sw.changed) {
    if (sw.resolved != null) {
      const clock = require('./swahiliClockParse').westernClockText(sw.resolved);
      return { when: `${day} ${clock}`.trim(), pendingHour: null, changed: true };
    }
    if (sw.ambiguous?.westernHour) return { when, pendingHour: sw.ambiguous.westernHour, changed: true };
    return { when, pendingHour, changed: false };
  }
  if (pendingHour != null && require('./callFixesD199').callFixesD199Enabled()) {
    const swPeriod = /\b(asubuhi|mchana|alasiri|jioni|usiku|alfajiri)\b/i.exec(raw);
    if (swPeriod) {
      const h = Number(pendingHour) % 12;
      const fits = [h * 60, (h + 12) * 60].filter((m) => periodFitsWord(swPeriod[1], m));
      if (fits.length === 1) {
        const clock = require('./swahiliClockParse').westernClockText(fits[0]);
        return { when: `${day} ${clock}`.trim(), pendingHour: null, changed: true };
      }
    }
  }
  if (whenHasClockTime(raw)) {
    const merged = dayCue(raw) ? raw : `${day} ${raw}`.trim();
    return { when: merged, pendingHour: null, changed: true };
  }
  const period = PERIOD_ANSWER.exec(raw);
  if (period && pendingHour != null) {
    const p = period[1].toLowerCase();
    const pm = /afternoon|mchana|evening|jioni|noon|midday|saa sita/.test(p);
    const hour = pendingHour === 12 ? 12 : pendingHour;
    return {
      when: `${day} ${hourWord(hour)} ${pm ? 'pm' : 'am'}`.trim(),
      pendingHour: null,
      changed: true,
    };
  }
  if (period) {
    return { when: `${day} ${period[1].toLowerCase()}`.trim(), pendingHour: null, changed: true };
  }
  if (pendingHour === 12 && /^(yes|yeah|yep|ndio|sawa|okay|ok)\b/i.test(raw)) {
    return { when: `${day} 12 pm`.trim(), pendingHour: null, changed: true };
  }
  const hour = BARE_HOUR.exec(raw);
  if (hour) {
    const n = Number(hour[1]);
    if (n >= 1 && n <= 12) return { when, pendingHour: n, changed: true };
  }
  return { when, pendingHour, changed: false };
}

/**
 * BRAIN_CALL_FIXES_D199: "9" is a Western hour; ask in Swahili clock time,
 * "Saa tatu asubuhi au saa tatu usiku?", via swahiliClock (#633,
 * src/conversation/swahiliClock.js). '' when the flag is off or the module is
 * not on the branch yet (then the old line stays).
 */
function swahiliPendingHourAsk(pendingHour) {
  if (!require('./callFixesD199').callFixesD199Enabled()) return '';
  const n = Number(pendingHour);
  if (!(n >= 1 && n <= 11)) return '';
  let clock = null;
  try {
    // eslint-disable-next-line global-require
    clock = require('./swahiliClock');
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  let am;
  let pm;
  if (clock && typeof clock.swahiliClock === 'function') {
    am = clock.swahiliClock(n * 60);
    pm = clock.swahiliClock((n + 12) * 60);
  } else {
    // Without #633 on the branch: same Swahili hour, period of each reading.
    const { swahiliHourWords } = require('./swahiliClockParse');
    const words = swahiliHourWords(((n + 6 - 1) % 12) + 1);
    const period = (h) => (h >= 6 && h < 12 ? 'asubuhi' : h >= 12 && h < 16 ? 'mchana' : h >= 16 && h < 20 ? 'jioni' : 'usiku');
    am = `${words} ${period(n)}`;
    pm = `${words} ${period(n + 12)}`;
  }
  if (!am || !pm) return '';
  return `${am.charAt(0).toUpperCase()}${am.slice(1)} au ${pm}?`;
}

function timeAskLine({ when = '', pendingHour = null, language = 'en', askCount = 1 } = {}) {
  const lang = confirmationLanguage(language);
  const sw = lang === 'sw' || lang === 'sheng';
  const day = dayCue(when);
  const dayEn = day || 'that day';
  const daySw = day === 'tomorrow' || day === 'kesho' ? 'kesho' : day === 'today' || day === 'leo' ? 'leo' : 'siku hiyo';
  if (pendingHour === 12) return sw ? 'Saa sita mchana?' : 'Twelve noon?';
  if (pendingHour != null) {
    const swClock = sw ? swahiliPendingHourAsk(pendingHour) : '';
    if (swClock) return swClock;
    return sw
      ? `Saa ${pendingHour} asubuhi au mchana?`
      : `${pendingHour} in the morning or in the afternoon?`;
  }
  if (askCount >= 2) return sw ? 'Asubuhi au mchana?' : 'Morning or afternoon?';
  return sw ? `Saa ngapi ${daySw}?` : `What time ${dayEn}?`;
}

module.exports = {
  DAY_CUE,
  clockPhrase,
  dayCue,
  swahiliPendingHourOf,
  isHomeVisitState,
  mergeTimeAnswer,
  timeAskCount,
  timeAskLine,
  whenHasClockTime,
  whenNeedsClockTime,
  whenValue,
};
