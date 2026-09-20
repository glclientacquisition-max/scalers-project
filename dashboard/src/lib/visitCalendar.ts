/** EAT visit week grouping for Inbox Jobs. Mirrors src/conversation/visitCalendar.js. */

const EAT = "Africa/Nairobi";

export type CalendarVisit = {
  id: string;
  status: string;
  service_name: string;
  when_text: string | null;
  window_start?: string | null;
  window_end?: string | null;
  address_landmark?: string | null;
  caller_name?: string | null;
};

export type WeekDay = {
  key: string;
  weekdayShort: string;
  dayNum: string;
  isToday: boolean;
};

function eatParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: EAT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    key: `${parts.year}-${parts.month}-${parts.day}`,
    weekdayShort: parts.weekday || "",
    dayNum: String(Number(parts.day)),
  };
}

export function eatYmd(date = new Date()): string {
  return eatParts(date).key;
}

export function mondayYmd(date = new Date()): string {
  const key = eatYmd(date);
  const asUtc = ymdToEatMidnight(key);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: EAT,
    weekday: "short",
  }).format(asUtc);
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const idx = order.indexOf(weekday);
  const back = idx >= 0 ? idx : 0;
  return eatYmd(new Date(asUtc.getTime() - back * 86400000));
}

function ymdToEatMidnight(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 60 * 60 * 1000);
}

export function shiftWeekYmd(monday: string, deltaWeeks: number): string {
  const start = ymdToEatMidnight(monday);
  return eatYmd(new Date(start.getTime() + deltaWeeks * 7 * 86400000));
}

export function weekDays(monday: string, now = new Date()): WeekDay[] {
  const today = eatYmd(now);
  const start = ymdToEatMidnight(monday);
  return Array.from({ length: 7 }, (_, i) => {
    const instant = new Date(start.getTime() + i * 86400000);
    const parts = eatParts(instant);
    return {
      key: parts.key,
      weekdayShort: parts.weekdayShort,
      dayNum: parts.dayNum,
      isToday: parts.key === today,
    };
  });
}

export function parseWeekParam(raw: string | undefined, now = new Date()): string {
  const value = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return mondayYmd(ymdToEatMidnight(value));
  return mondayYmd(now);
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function validYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/** Absolute calendar day in When text. Desk When+Save must not fall back to today+time. */
export function parseAbsoluteWhenDate(
  raw: string
): { year: number; month: number; day: number } | null {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(
    text
  );
  if (named) {
    const day = Number(named[1]);
    const month = MONTH_INDEX[named[2].toLowerCase()];
    const year = Number(named[3]);
    if (month && validYmd(year, month, day)) return { year, month, day };
  }

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (validYmd(year, month, day)) return { year, month, day };
  }

  const dmy = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (validYmd(year, month, day)) return { year, month, day };
  }

  return null;
}

export function stampScheduleWindows(
  whenText: string,
  now = new Date()
): { when_text: string; window_start: string | null; window_end: string | null } {
  const text = String(whenText || "").trim();
  const instant = visitInstant(
    {
      id: "stamp",
      status: "requested",
      service_name: "",
      when_text: text,
      window_start: null,
      window_end: null,
    },
    now
  );
  if (!instant || Number.isNaN(instant.getTime())) {
    return { when_text: text, window_start: null, window_end: null };
  }
  const iso = instant.toISOString();
  return { when_text: text, window_start: iso, window_end: iso };
}

export function visitInstant(visit: CalendarVisit, now: Date): Date | null {
  if (visit.window_start) {
    const parsed = Date.parse(visit.window_start);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  const text = String(visit.when_text || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const absolute = parseAbsoluteWhenDate(text);
  const clock =
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(text) ||
    /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  let minutes = 10 * 60;
  if (clock) {
    if (clock[3]) {
      let hour = Number(clock[1]);
      const min = Number(clock[2] || 0);
      const isPm = /^p/i.test(clock[3]);
      if (hour === 12) hour = isPm ? 12 : 0;
      else if (isPm) hour += 12;
      minutes = hour * 60 + min;
    } else {
      minutes = Number(clock[1]) * 60 + Number(clock[2]);
    }
  } else if (/\b(afternoon|mchana)\b/i.test(lower)) minutes = 14 * 60;
  else if (/\b(evening|jioni)\b/i.test(lower)) minutes = 17 * 60;
  else if (/\btonight\b/i.test(lower)) minutes = 19 * 60;

  if (absolute) {
    const y = String(absolute.year);
    const m = String(absolute.month).padStart(2, "0");
    const d = String(absolute.day).padStart(2, "0");
    const start = ymdToEatMidnight(`${y}-${m}-${d}`);
    return new Date(start.getTime() + minutes * 60 * 1000);
  }

  const todayKey = eatYmd(now);
  let dayOffset = 0;
  if (/\btomorrow|kesho\b/i.test(lower)) dayOffset = 1;
  else if (/\btoday|leo\b/i.test(lower)) dayOffset = 0;
  else {
    const names = [
      ["sunday", 0],
      ["monday", 1],
      ["tuesday", 2],
      ["wednesday", 3],
      ["thursday", 4],
      ["friday", 5],
      ["saturday", 6],
    ] as const;
    const hit = names.find(([name]) => lower.includes(name));
    if (hit) {
      const nowEat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      const from = nowEat.getUTCDay();
      dayOffset = (hit[1] - from + 7) % 7;
    } else if (!clock && !/\btoday|leo|tomorrow|kesho\b/i.test(lower)) {
      return null;
    }
  }
  const start = ymdToEatMidnight(todayKey);
  return new Date(start.getTime() + dayOffset * 86400000 + minutes * 60 * 1000);
}

export function groupVisitsForWeek(
  visits: CalendarVisit[],
  monday: string,
  now = new Date()
): { days: WeekDay[]; byDay: Record<string, CalendarVisit[]>; unscheduled: CalendarVisit[] } {
  const days = weekDays(monday, now);
  const keys = new Set(days.map((day) => day.key));
  const byDay: Record<string, CalendarVisit[]> = Object.fromEntries(
    days.map((day) => [day.key, []])
  );
  const unscheduled: CalendarVisit[] = [];
  for (const visit of visits) {
    if (String(visit.status || "").toLowerCase() === "cancelled") continue;
    const instant = visitInstant(visit, now);
    const key = instant ? eatYmd(instant) : null;
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

export function parseDayParam(raw: string | undefined, now = new Date()): string {
  const value = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return eatYmd(now);
}

export function shiftDayYmd(ymd: string, deltaDays: number): string {
  const start = ymdToEatMidnight(ymd);
  return eatYmd(new Date(start.getTime() + deltaDays * 86400000));
}

export function dayHeading(ymd: string): string {
  const instant = ymdToEatMidnight(ymd);
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: EAT,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(instant);
}

export function weekHeading(monday: string): string {
  const start = ymdToEatMidnight(monday);
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = new Intl.DateTimeFormat("en-KE", {
    timeZone: EAT,
    day: "numeric",
    month: "short",
  });
  return `${fmt.format(start)} to ${fmt.format(end)}`;
}
