// EAT week calendar for open visits. Desk week view mirrors this grouping.

const { eatParts } = require('./businessHours');
const { parseAbsoluteWhenDate, resolveAppointmentWhen } = require('./appointmentHours');

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86400000;

function eatYmd(date = new Date()) {
  const eat = new Date(date.getTime() + EAT_OFFSET_MS);
  const y = eat.getUTCFullYear();
  const m = String(eat.getUTCMonth() + 1).padStart(2, '0');
  const d = String(eat.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function eatMidnightUtc(ymd) {
  const [y, m, d] = String(ymd || '')
    .split('-')
    .map((part) => Number(part));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - EAT_OFFSET_MS);
}

function mondayYmd(date = new Date()) {
  const key = eatYmd(date);
  const midnight = eatMidnightUtc(key);
  if (!midnight) return key;
  const weekday = eatParts(midnight).weekday;
  const sunFirst = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const idx = sunFirst.indexOf(weekday);
  const daysFromMonday = idx === 0 ? 6 : idx - 1;
  return eatYmd(new Date(midnight.getTime() - daysFromMonday * DAY_MS));
}

function shiftWeekYmd(monday, deltaWeeks) {
  const start = eatMidnightUtc(monday);
  if (!start) return monday;
  return eatYmd(new Date(start.getTime() + Number(deltaWeeks || 0) * 7 * DAY_MS));
}

function weekDayKeys(mondayYmdValue) {
  const start = eatMidnightUtc(mondayYmdValue);
  if (!start) return [];
  return Array.from({ length: 7 }, (_, i) => {
    const instant = new Date(start.getTime() + i * DAY_MS);
    return {
      key: eatYmd(instant),
      weekday: eatParts(instant).weekday,
      weekdayLong: eatParts(instant).weekdayLong,
      dateLabel: eatParts(instant).dateLabel,
    };
  });
}

function visitInstant(visit, now = new Date()) {
  if (visit?.window_start) {
    const parsed = Date.parse(visit.window_start);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  const resolved = resolveAppointmentWhen(visit?.when_text || '', now);
  return resolved.ok ? resolved.instant : null;
}

const RELATIVE_DAY_RE = /\b(?:today|tomorrow|tonight|leo|kesho)\b/i;
const RELATIVE_DAY_REPLACE_RE = /\b(?:today|tomorrow|tonight|leo|kesho)\b/gi;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseInstant(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function shiftYmd(ymd, days) {
  const start = eatMidnightUtc(ymd);
  if (!start) return null;
  return eatYmd(new Date(start.getTime() + Number(days || 0) * DAY_MS));
}

function shortDate(dayKey) {
  const [year, month, day] = String(dayKey || '')
    .split('-')
    .map((part) => Number(part));
  if (!year || !month || !day || month < 1 || month > 12) return '';
  return `${day} ${SHORT_MONTHS[month - 1]}`;
}

function spokenDayWord(dayKey, now) {
  if (!dayKey) return '';
  const today = eatYmd(now);
  if (dayKey === today) return 'today';
  if (dayKey === shiftYmd(today, 1)) return 'tomorrow';
  const midnight = eatMidnightUtc(dayKey);
  if (!midnight) return shortDate(dayKey);
  return eatParts(midnight).weekdayLong || shortDate(dayKey);
}

const WEEKDAY_KEYS = [
  ['sun', /\b(?:sunday|jumapili)\b/i],
  ['mon', /\b(?:monday|jumatatu)\b/i],
  ['tue', /\b(?:tuesday|jumanne)\b/i],
  ['wed', /\b(?:wednesday|jumatano)\b/i],
  ['thu', /\b(?:thursday|alhamisi)\b/i],
  ['fri', /\b(?:friday|ijumaa|jumaa)\b/i],
  ['sat', /\b(?:saturday|jumamosi)\b/i],
];

function singleWeekdayKey(whenText) {
  const text = String(whenText || '');
  const hits = WEEKDAY_KEYS.filter(([, re]) => re.test(text));
  if (hits.length !== 1) return null;
  return hits[0][0];
}

function weekdayOffset(fromKey, toKey) {
  const order = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const from = order.indexOf(fromKey);
  const to = order.indexOf(toKey);
  if (from < 0 || to < 0) return null;
  return (to - from + 7) % 7;
}

function bareRelativeDay(whenText, anchor) {
  const raw = String(whenText || '');
  const base = eatYmd(anchor);
  if (/\b(?:tomorrow|kesho)\b/i.test(raw)) return shiftYmd(base, 1);
  if (/\b(?:today|leo|tonight)\b/i.test(raw)) return base;
  return null;
}

function ymdFromAbsolute(absolute) {
  if (!absolute) return null;
  const month = String(absolute.month).padStart(2, '0');
  const day = String(absolute.day).padStart(2, '0');
  return `${absolute.year}-${month}-${day}`;
}

function livedWhenLabel(whenText, { past, dayKey, spokenDay, relative }) {
  const original = String(whenText || '').replace(/\s+/g, ' ').trim();
  if (past) {
    const stripped = original
      .replace(RELATIVE_DAY_REPLACE_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const dateBit = dayKey ? shortDate(dayKey) : '';
    const core = [dateBit, stripped].filter(Boolean).join(' ').trim();
    return core ? `past ${core}` : 'past';
  }
  if (relative && spokenDay) {
    return original.replace(RELATIVE_DAY_REPLACE_RE, spokenDay).replace(/\s+/g, ' ').trim();
  }
  return original;
}

/**
 * Whether a saved visit is still ahead, in East Africa Time.
 * A stored window wins. "Tomorrow" / "today" without a window is read from
 * created_at, not from the moment this call starts.
 * @returns {{ past: boolean, relative: boolean, dayKey: string|null, instant: Date|null, spokenDay: string|null, whenLabel: string, upcoming: boolean }}
 */
function classifyLivedVisit(row, now = new Date()) {
  const whenText = String(row?.when_text || row?.whenText || '')
    .replace(/\s+/g, ' ')
    .trim();
  const relative = RELATIVE_DAY_RE.test(whenText);
  const windowInstant =
    parseInstant(row?.window_end || row?.windowEnd) ||
    parseInstant(row?.window_start || row?.windowStart);
  const created = parseInstant(row?.created_at || row?.createdAt);

  let instant = null;
  let dayKey = null;
  let pastMode = 'none';

  if (windowInstant) {
    instant = windowInstant;
    dayKey = eatYmd(windowInstant);
    pastMode = 'instant';
  } else if (whenText) {
    const anchor = relative ? created || now : created;
    if (anchor) {
      const resolved = resolveAppointmentWhen(whenText, anchor);
      if (resolved.ok && !resolved.isNow) {
        instant = resolved.instant;
        dayKey = eatYmd(resolved.instant);
        pastMode = resolved.periodLabel ? 'period' : 'instant';
      } else if (relative) {
        dayKey = bareRelativeDay(whenText, anchor);
        pastMode = 'date';
      } else if (created && !/\blast\b/i.test(whenText)) {
        const weekdayKey = singleWeekdayKey(whenText);
        const offset = weekdayKey
          ? weekdayOffset(eatParts(created).weekday, weekdayKey)
          : null;
        if (offset != null) {
          const days = /\bnext\b/i.test(whenText) && offset === 0 ? 7 : offset;
          dayKey = shiftYmd(eatYmd(created), days);
          pastMode = 'date';
        }
      }
    }
    if (!dayKey) {
      const absoluteKey = ymdFromAbsolute(parseAbsoluteWhenDate(whenText));
      if (absoluteKey) {
        dayKey = absoluteKey;
        const resolved = resolveAppointmentWhen(whenText, now);
        if (resolved.ok && !resolved.isNow && !resolved.periodLabel) {
          instant = resolved.instant;
          pastMode = 'instant';
        } else {
          pastMode = 'date';
        }
      }
    }
  }

  let past = false;
  if ((pastMode === 'instant' || pastMode === 'period') && instant) {
    past = instant.getTime() < now.getTime();
  } else if (pastMode === 'date' && dayKey) {
    past = dayKey < eatYmd(now);
  }

  const spokenDay = past ? 'past' : spokenDayWord(dayKey, now) || null;
  const whenLabel = livedWhenLabel(whenText, {
    past,
    dayKey,
    spokenDay,
    relative,
  });
  return {
    past,
    relative,
    dayKey,
    instant,
    spokenDay,
    whenLabel,
    upcoming: !past && Boolean(dayKey || instant || whenText),
  };
}

/**
 * Desk When+Save: stamp when_text and calendar windows together.
 * Ignores any prior window_start so Today/Week cannot keep a stale instant.
 * Unparsed text clears both windows.
 */
function stampScheduleWindows(whenText, now = new Date()) {
  const text = String(whenText || '').trim();
  const instant = visitInstant({ when_text: text, window_start: null }, now);
  if (!instant || Number.isNaN(instant.getTime())) {
    return { when_text: text, window_start: null, window_end: null };
  }
  const iso = instant.toISOString();
  return { when_text: text, window_start: iso, window_end: iso };
}

function visitDayKey(visit, now = new Date()) {
  const instant = visitInstant(visit, now);
  return instant ? eatYmd(instant) : null;
}

function groupVisitsByDay(visits, monday, now = new Date()) {
  const days = weekDayKeys(monday);
  const keys = new Set(days.map((day) => day.key));
  const byDay = Object.fromEntries(days.map((day) => [day.key, []]));
  const unscheduled = [];
  for (const visit of Array.isArray(visits) ? visits : []) {
    const status = String(visit?.status || '').toLowerCase();
    if (status === 'cancelled') continue;
    const key = visitDayKey(visit, now);
    if (key && keys.has(key)) byDay[key].push(visit);
    else if (!key) unscheduled.push(visit);
  }
  for (const key of Object.keys(byDay)) {
    byDay[key].sort((a, b) => {
      const ta = visitInstant(a, now)?.getTime() || 0;
      const tb = visitInstant(b, now)?.getTime() || 0;
      return ta - tb;
    });
  }
  return { days, byDay, unscheduled };
}

const SLOT_MS = 60 * 60 * 1000;

function digitsPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Same EAT day, 60-minute windows. Informational only.
 * Teams can serve more than one visit in the same hour unless policies say otherwise.
 */
function visitOverlapsOpen(hours, openAppointments = [], now = new Date(), opts = {}) {
  const startDate = hours?.resolved?.instant;
  if (!startDate || Number.isNaN(startDate.getTime())) return null;
  const start = startDate.getTime();
  const end = start + SLOT_MS;
  const day = eatYmd(startDate);
  const ignoreId = String(opts.ignoreId || '').trim();
  const ignorePhone = digitsPhone(opts.ignoreCallerPhone);
  for (const row of Array.isArray(openAppointments) ? openAppointments : []) {
    if (ignoreId && String(row?.id || '') === ignoreId) continue;
    if (ignorePhone) {
      const rowPhone = digitsPhone(row?.caller_phone || row?.phone);
      if (rowPhone && rowPhone === ignorePhone) continue;
    }
    const status = String(row?.status || '').toLowerCase();
    if (status && status !== 'requested' && status !== 'confirmed') continue;
    const existing = visitInstant(row, now);
    if (!existing) continue;
    if (eatYmd(existing) !== day) continue;
    const eStart = existing.getTime();
    const eEnd = eStart + SLOT_MS;
    if (eEnd <= now.getTime()) continue;
    if (start < eEnd && eStart < end) {
      return {
        error: 'That time overlaps an open visit. Offer another slot.',
        code: 'overlap',
      };
    }
  }
  return null;
}

function formatOpenVisitsForPrompt(visits = [], now = new Date()) {
  const lines = (Array.isArray(visits) ? visits : [])
    .filter((row) => {
      const status = String(row?.status || '').toLowerCase();
      return status === 'requested' || status === 'confirmed';
    })
    .map((row) => {
      const lived = classifyLivedVisit(row, now);
      if (lived.past) return '';
      const when = String(lived.whenLabel || row.when_text || '').trim() || 'time unknown';
      const service = String(row.service_name || 'visit').trim();
      const status = String(row.status || '').trim();
      return `- ${when} | ${service} (${status})`;
    })
    .filter(Boolean)
    .slice(0, 24);
  if (!lines.length) return '';
  return [
    'OPEN VISITS (already on the book this week. Same-hour visits are allowed. You may still book this window. Mention it is already busy only if useful. Do not refuse solely because another visit sits there unless POLICIES say one at a time):',
    ...lines,
  ].join('\n');
}

module.exports = {
  eatYmd,
  eatMidnightUtc,
  mondayYmd,
  shiftWeekYmd,
  weekDayKeys,
  visitInstant,
  classifyLivedVisit,
  stampScheduleWindows,
  visitDayKey,
  visitOverlapsOpen,
  groupVisitsByDay,
  formatOpenVisitsForPrompt,
};
