// EAT week calendar for open visits. Desk week view mirrors this grouping.

const { eatParts } = require('./businessHours');
const { resolveAppointmentWhen } = require('./appointmentHours');

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

function formatOpenVisitsForPrompt(visits = [], now = new Date()) {
  const rows = (Array.isArray(visits) ? visits : [])
    .filter((row) => {
      const status = String(row?.status || '').toLowerCase();
      return status === 'requested' || status === 'confirmed';
    })
    .slice(0, 24);
  if (!rows.length) return '';
  const lines = rows.map((row) => {
    const when = String(row.when_text || '').trim() || 'time unknown';
    const service = String(row.service_name || 'visit').trim();
    const status = String(row.status || '').trim();
    return `- ${when} | ${service} (${status})`;
  });
  return [
    'OPEN VISITS (already booked this week. Do not offer these exact windows. Offer another time):',
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
  visitDayKey,
  groupVisitsByDay,
  formatOpenVisitsForPrompt,
};
