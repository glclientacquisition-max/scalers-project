// Structured weekly hours + EAT open/closed helpers for live calls.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** Default Kenya SME hours: Mon-Sat 08:00-18:00, Sunday closed. */
function defaultHoursSchedule(location = '') {
  const weekday = { open: '08:00', close: '18:00' };
  return {
    timezone: 'Africa/Nairobi',
    location: String(location || '').trim(),
    days: {
      mon: { ...weekday },
      tue: { ...weekday },
      wed: { ...weekday },
      thu: { ...weekday },
      fri: { ...weekday },
      sat: { ...weekday },
      sun: null,
    },
  };
}

function normalizeTime(raw) {
  const m = String(raw || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseDayHours(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object') return null;
  const open = normalizeTime(raw.open);
  const close = normalizeTime(raw.close);
  if (!open || !close) return null;
  if (open >= close) return null;
  return { open, close };
}

/**
 * Normalize DB / form JSON into a schedule, or null if unusable.
 * @param {unknown} raw
 * @returns {ReturnType<typeof defaultHoursSchedule> | null}
 */
function parseHoursSchedule(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;

  const daysIn = obj.days && typeof obj.days === 'object' ? obj.days : obj;
  const days = {};
  let anyOpen = false;
  for (const key of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    const day = parseDayHours(daysIn[key]);
    days[key] = day;
    if (day) anyOpen = true;
  }
  if (!anyOpen) return null;

  return {
    timezone: 'Africa/Nairobi',
    location: String(obj.location || '').trim(),
    days,
  };
}

/** Minutes since local midnight for HH:MM. */
function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Africa/Nairobi wall-clock parts (EAT = UTC+3, no DST).
 * @param {Date} [date]
 */
function eatParts(date = new Date()) {
  const eatMs = date.getTime() + 3 * 60 * 60 * 1000;
  const d = new Date(eatMs);
  const weekday = DAY_KEYS[d.getUTCDay()];
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const weekdayLong = d.toLocaleDateString('en-KE', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const dateLabel = d.toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return {
    weekday,
    weekdayLong,
    dateLabel,
    hours,
    minutes,
    timeLabel: `${hh}:${mm}`,
    minutesSinceMidnight: hours * 60 + minutes,
  };
}

/**
 * Human clock line for the context header.
 * e.g. "Friday, 9:34 PM EAT"
 */
function formatEatNowLabel(date = new Date()) {
  const p = eatParts(date);
  const hour12 = ((p.hours + 11) % 12) + 1;
  const ampm = p.hours >= 12 ? 'PM' : 'AM';
  const min = String(p.minutes).padStart(2, '0');
  return `${p.weekdayLong}, ${hour12}:${min} ${ampm} EAT`;
}

/**
 * @returns {'open'|'closed'|'unknown'}
 */
function openClosedStatus(schedule, date = new Date()) {
  const parsed = parseHoursSchedule(schedule);
  if (!parsed) return 'unknown';
  const p = eatParts(date);
  const day = parsed.days[p.weekday];
  if (!day) return 'closed';
  const now = p.minutesSinceMidnight;
  const open = timeToMinutes(day.open);
  const close = timeToMinutes(day.close);
  if (now >= open && now < close) return 'open';
  return 'closed';
}

function formatScheduleSummary(schedule) {
  const parsed = parseHoursSchedule(schedule);
  if (!parsed) return '';

  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const lines = [];
  let i = 0;
  while (i < order.length) {
    const key = order[i];
    const day = parsed.days[key];
    let j = i + 1;
    while (j < order.length) {
      const next = parsed.days[order[j]];
      const same =
        (!day && !next) ||
        (day && next && day.open === next.open && day.close === next.close);
      if (!same) break;
      j += 1;
    }
    const label =
      j === i + 1
        ? DAY_LABELS[key]
        : `${DAY_LABELS[key]}-${DAY_LABELS[order[j - 1]]}`;
    lines.push(day ? `${label}: ${day.open}-${day.close} EAT` : `${label}: closed`);
    i = j;
  }

  const loc = parsed.location;
  return loc ? `${lines.join('; ')}. Location: ${loc}` : `${lines.join('; ')}.`;
}

/**
 * Text block for llm_system_prompt compiler (hours & location).
 */
function formatHoursForCompiler(schedule, locationFallback = '') {
  const parsed = parseHoursSchedule(schedule);
  const summary = formatScheduleSummary(parsed || schedule);
  const loc =
    (parsed && parsed.location) || String(locationFallback || '').trim();
  if (summary && loc && !/location:/i.test(summary)) {
    return `${summary}\nLocation / coverage: ${loc}`;
  }
  if (summary) return summary;
  return loc;
}

module.exports = {
  DAY_LABELS,
  defaultHoursSchedule,
  parseHoursSchedule,
  eatParts,
  formatEatNowLabel,
  openClosedStatus,
  formatScheduleSummary,
  formatHoursForCompiler,
};
