export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayHours = { open: string; close: string } | null;

export type HoursSchedule = {
  timezone: "Africa/Nairobi";
  location: string;
  days: Record<DayKey, DayHours>;
};

export const DAY_ORDER: DayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function weekday(): { open: string; close: string } {
  return { open: "08:00", close: "18:00" };
}

export function defaultHoursSchedule(location = ""): HoursSchedule {
  return {
    timezone: "Africa/Nairobi",
    location: location.trim(),
    days: {
      mon: weekday(),
      tue: weekday(),
      wed: weekday(),
      thu: weekday(),
      fri: weekday(),
      sat: weekday(),
      sun: null,
    },
  };
}

function normalizeTime(raw: unknown): string | null {
  const m = String(raw || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseDay(raw: unknown): DayHours {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const row = raw as { open?: unknown; close?: unknown };
  const open = normalizeTime(row.open);
  const close = normalizeTime(row.close);
  if (!open || !close || open >= close) return null;
  return { open, close };
}

export function parseHoursSchedule(raw: unknown): HoursSchedule | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const root = obj as { days?: unknown; location?: unknown };
  const daysIn =
    root.days && typeof root.days === "object"
      ? (root.days as Record<string, unknown>)
      : (obj as Record<string, unknown>);

  const days = {} as Record<DayKey, DayHours>;
  let anyOpen = false;
  for (const key of DAY_ORDER) {
    const day = parseDay(daysIn[key]);
    days[key] = day;
    if (day) anyOpen = true;
  }
  if (!anyOpen) return null;

  return {
    timezone: "Africa/Nairobi",
    location: String(root.location || "").trim(),
    days,
  };
}

/** Seed UI from DB schedule, or default Mon-Sat if missing. */
export function scheduleForForm(
  raw: unknown,
  locationFallback = ""
): HoursSchedule {
  const parsed = parseHoursSchedule(raw);
  if (parsed) {
    if (!parsed.location && locationFallback) {
      return { ...parsed, location: locationFallback.trim() };
    }
    return parsed;
  }
  return defaultHoursSchedule(locationFallback);
}

export function formatScheduleSummary(schedule: HoursSchedule | null): string {
  const parsed = parseHoursSchedule(schedule);
  if (!parsed) return "";

  const short: Record<DayKey, string> = {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
  };

  const lines: string[] = [];
  let i = 0;
  while (i < DAY_ORDER.length) {
    const key = DAY_ORDER[i];
    const day = parsed.days[key];
    let j = i + 1;
    while (j < DAY_ORDER.length) {
      const next = parsed.days[DAY_ORDER[j]];
      const same =
        (!day && !next) ||
        Boolean(
          day && next && day.open === next.open && day.close === next.close
        );
      if (!same) break;
      j += 1;
    }
    const label =
      j === i + 1
        ? short[key]
        : `${short[key]}-${short[DAY_ORDER[j - 1]]}`;
    lines.push(day ? `${label}: ${day.open}-${day.close} EAT` : `${label}: closed`);
    i = j;
  }

  return parsed.location
    ? `${lines.join("; ")}. Location: ${parsed.location}`
    : `${lines.join("; ")}.`;
}

export function formatHoursForCompiler(schedule: HoursSchedule | null): string {
  return formatScheduleSummary(schedule);
}
