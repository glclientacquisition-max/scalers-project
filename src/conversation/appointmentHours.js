// Resolve appointment when_text in EAT and authorize against tenant hours.
// LLM interprets language; this module enforces the business rule.

const {
  DAY_KEYS,
  parseHoursSchedule,
  eatParts,
  openClosedStatus,
  timeToMinutes,
} = require('./businessHours');

const CODES = Object.freeze({
  valid: 'valid',
  closed_day: 'closed_day',
  outside_hours: 'outside_hours',
  unparsed_when: 'unparsed_when',
  currently_closed: 'currently_closed',
});

const FULL_DAY = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

const WEEKDAY_RE = {
  sun: /\b(sunday|jumapili)\b/i,
  mon: /\b(monday|jumatatu)\b/i,
  tue: /\b(tuesday|jumanne)\b/i,
  wed: /\b(wednesday|jumatano)\b/i,
  thu: /\b(thursday|alhamisi)\b/i,
  fri: /\b(friday|ijumaa|jumaa)\b/i,
  sat: /\b(saturday|jumamosi)\b/i,
};

const AMBIGUOUS_RE =
  /\b(sometime|whenever|soon|later|any\s*time|anytime|tutaongea|siku moja)\b/i;

function EAT_OFFSET_MS() {
  return 3 * 60 * 60 * 1000;
}

function minutesToHour12(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (m) return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
  return `${hour12} ${ampm}`;
}

function parseClockMinutes(raw) {
  const text = String(raw || '');
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(text);
  if (ampm) {
    let hour = Number(ampm[1]);
    const min = Number(ampm[2] || 0);
    if (!Number.isFinite(hour) || !Number.isFinite(min)) return null;
    if (hour < 1 || hour > 12 || min > 59) return null;
    const isPm = /^p/i.test(ampm[3]);
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
    return hour * 60 + min;
  }
  const hm = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (hm) {
    return Number(hm[1]) * 60 + Number(hm[2]);
  }
  return null;
}

function parsePeriodMinutes(raw) {
  const text = String(raw || '');
  if (/\b(morning|asubuhi)\b/i.test(text)) return 10 * 60;
  if (/\b(afternoon|mchana)\b/i.test(text)) return 14 * 60;
  if (/\b(evening|jioni)\b/i.test(text)) return 17 * 60;
  if (/\btonight\b/i.test(text)) return 19 * 60;
  return null;
}

function parseWeekdayKey(raw) {
  const text = String(raw || '');
  const hits = [];
  for (const [key, re] of Object.entries(WEEKDAY_RE)) {
    if (re.test(text)) hits.push(key);
  }
  if (hits.length !== 1) return null;
  return hits[0];
}

function dayOffset(fromKey, toKey) {
  const from = DAY_KEYS.indexOf(fromKey);
  const to = DAY_KEYS.indexOf(toKey);
  if (from < 0 || to < 0) return null;
  return (to - from + 7) % 7;
}

function eatInstant(now, dayOffsetDays, minutesSinceMidnight) {
  const p = eatParts(now);
  const eatNow = now.getTime() + EAT_OFFSET_MS();
  const eatMidnight = eatNow - p.minutesSinceMidnight * 60 * 1000;
  const targetEat =
    eatMidnight + dayOffsetDays * 86400000 + minutesSinceMidnight * 60 * 1000;
  return new Date(targetEat - EAT_OFFSET_MS());
}

/**
 * Turn free-text when_text into an EAT instant. Null if unsafe to guess.
 * @param {string} whenText
 * @param {Date} [now]
 * @returns {{ ok: true, instant: Date, isNow: boolean, weekday: string, minutesSinceMidnight: number, weekdayLong: string } | { ok: false }}
 */
function resolveAppointmentWhen(whenText, now = new Date()) {
  const raw = String(whenText || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { ok: false };
  if (AMBIGUOUS_RE.test(raw)) return { ok: false };
  if (/\bnext\s+week\b/i.test(raw) && !parseWeekdayKey(raw)) return { ok: false };

  const nowParts = eatParts(now);
  const clock = parseClockMinutes(raw);
  const period = clock == null ? parsePeriodMinutes(raw) : null;
  const minutes = clock != null ? clock : period;
  const weekday = parseWeekdayKey(raw);
  const hasToday = /\b(today|leo)\b/i.test(raw) || /\btonight\b/i.test(raw);
  const hasTomorrow = /\b(tomorrow|kesho)\b/i.test(raw);
  const isNowPhrase = /\b(now|right now|sasa hivi)\b/i.test(raw);

  if (hasToday && hasTomorrow) return { ok: false };
  if (isNowPhrase && (hasTomorrow || weekday || clock != null)) return { ok: false };

  if (isNowPhrase && minutes == null && !weekday && !hasTomorrow) {
    return {
      ok: true,
      instant: now,
      isNow: true,
      weekday: nowParts.weekday,
      weekdayLong: nowParts.weekdayLong,
      minutesSinceMidnight: nowParts.minutesSinceMidnight,
    };
  }

  if (minutes == null) return { ok: false };

  let offset = null;
  if (hasTomorrow) offset = 1;
  else if (hasToday) offset = 0;
  else if (weekday) {
    offset = dayOffset(nowParts.weekday, weekday);
    if (/\bnext\b/i.test(raw) && offset === 0) offset = 7;
  } else {
    offset = 0;
  }

  if (offset == null) return { ok: false };

  const instant = eatInstant(now, offset, minutes);
  const parts = eatParts(instant);
  return {
    ok: true,
    instant,
    isNow: false,
    weekday: parts.weekday,
    weekdayLong: parts.weekdayLong,
    minutesSinceMidnight: minutes,
  };
}

function nextOpenDay(schedule, now = new Date()) {
  const parsed = parseHoursSchedule(schedule);
  if (!parsed) return null;
  const start = eatParts(now);
  const startIdx = DAY_KEYS.indexOf(start.weekday);
  for (let i = 1; i <= 7; i += 1) {
    const key = DAY_KEYS[(startIdx + i) % 7];
    const day = parsed.days[key];
    if (day) {
      return {
        weekday: key,
        label: FULL_DAY[key],
        open: day.open,
        close: day.close,
        openLabel: minutesToHour12(timeToMinutes(day.open)),
        closeLabel: minutesToHour12(timeToMinutes(day.close)),
      };
    }
  }
  return null;
}

function classifyInstant(schedule, instant, { isNow = false } = {}) {
  const parsed = parseHoursSchedule(schedule);
  if (!parsed) {
    return { code: CODES.valid, valid: true, enforced: false };
  }
  if (isNow) {
    const status = openClosedStatus(parsed, instant);
    if (status === 'closed') {
      return { code: CODES.currently_closed, valid: false, enforced: true };
    }
    return { code: CODES.valid, valid: true, enforced: true };
  }
  const parts = eatParts(instant);
  const day = parsed.days[parts.weekday];
  if (!day) {
    return {
      code: CODES.closed_day,
      valid: false,
      enforced: true,
      weekday: parts.weekday,
      weekdayLong: parts.weekdayLong || FULL_DAY[parts.weekday],
    };
  }
  const open = timeToMinutes(day.open);
  const close = timeToMinutes(day.close);
  const t = parts.minutesSinceMidnight;
  if (t < open || t >= close) {
    return {
      code: CODES.outside_hours,
      valid: false,
      enforced: true,
      weekday: parts.weekday,
      weekdayLong: parts.weekdayLong || FULL_DAY[parts.weekday],
      open: day.open,
      close: day.close,
      closeLabel: minutesToHour12(close),
      openLabel: minutesToHour12(open),
    };
  }
  return {
    code: CODES.valid,
    valid: true,
    enforced: true,
    weekday: parts.weekday,
    weekdayLong: parts.weekdayLong || FULL_DAY[parts.weekday],
    open: day.open,
    close: day.close,
  };
}

/**
 * Authorize a requested visit time against tenant hours.
 * @returns {{ code: string, valid: boolean, resolved?: object, nextOpen?: object, closeLabel?: string, weekdayLong?: string }}
 */
function evaluateAppointmentHours({ whenText, schedule, now = new Date() } = {}) {
  const resolved = resolveAppointmentWhen(whenText, now);
  if (!resolved.ok) {
    return { code: CODES.unparsed_when, valid: false, resolved: null };
  }
  const classified = classifyInstant(schedule, resolved.instant, {
    isNow: resolved.isNow,
  });
  const nextOpen = classified.valid
    ? null
    : nextOpenDay(schedule, resolved.instant);
  return {
    ...classified,
    resolved,
    nextOpen,
    weekdayLong: classified.weekdayLong || resolved.weekdayLong,
  };
}

function formatRequestedWhenLabel(hours) {
  const resolved = hours?.resolved;
  if (!resolved || resolved.isNow) return '';
  const day = resolved.weekdayLong || FULL_DAY[resolved.weekday] || '';
  const time = minutesToHour12(resolved.minutesSinceMidnight);
  if (!day || !time) return '';
  return `${day} at ${time}`;
}

module.exports = {
  CODES,
  FULL_DAY,
  resolveAppointmentWhen,
  evaluateAppointmentHours,
  classifyInstant,
  nextOpenDay,
  formatRequestedWhenLabel,
  minutesToHour12,
};
