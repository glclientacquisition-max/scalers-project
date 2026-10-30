import { DAY_ORDER, defaultHoursSchedule, type DayKey, type HoursSchedule } from "./hoursSchedule";

/**
 * Add many: hours written as a sentence ("Mon-Fri 8 to 6, Sat half day, Sun closed") read into the weekly grid.
 * Pure and conservative: anything it has to guess (a bare "8 to 6", "half day", a day with no time) sets `unsure`
 * with a short note, so the card opens unticked and the owner checks it. Returns null when no day gets a time.
 */
export type HoursTextResult = { schedule: HoursSchedule; unsure: boolean; note: string | null };

const DAY_WORDS: [RegExp, DayKey][] = [
  [/^mon(day)?$/, "mon"],
  [/^tue(s|sday)?$/, "tue"],
  [/^wed(s|nesday)?$/, "wed"],
  [/^thu(r|rs|rsday)?$/, "thu"],
  [/^fri(day)?$/, "fri"],
  [/^sat(urday)?$/, "sat"],
  [/^sun(day)?$/, "sun"],
];
const dayOf = (w: string): DayKey | null => DAY_WORDS.find(([re]) => re.test(w.toLowerCase()))?.[1] ?? null;
const DAY_RE = "mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";

function span(a: DayKey, b: DayKey): DayKey[] {
  const i = DAY_ORDER.indexOf(a);
  const j = DAY_ORDER.indexOf(b);
  return j >= i ? DAY_ORDER.slice(i, j + 1) : [...DAY_ORDER.slice(i), ...DAY_ORDER.slice(0, j + 1)];
}

/** Days a segment names: ranges, lists, weekdays, weekends, daily. */
function segmentDays(seg: string): DayKey[] {
  const s = seg.toLowerCase();
  if (/\b(daily|every ?day|7 days|seven days|all week|mon(day)?\s*(-|–|—|to|through|thru)\s*sun(day)?)\b/.test(s)) return [...DAY_ORDER];
  const out: DayKey[] = [];
  const add = (d: DayKey[]) => d.forEach((x) => !out.includes(x) && out.push(x));
  if (/\bweekdays?\b/.test(s)) add(["mon", "tue", "wed", "thu", "fri"]);
  if (/\bweekends?\b/.test(s)) add(["sat", "sun"]);
  const range = new RegExp(`\\b(${DAY_RE})\\s*(?:-|–|—|to|through|thru|until|till)\\s*(${DAY_RE})\\b`, "gi");
  let rest = s;
  for (const m of s.matchAll(range)) {
    const a = dayOf(m[1]);
    const b = dayOf(m[2]);
    if (a && b) add(span(a, b));
    rest = rest.replace(m[0], " ");
  }
  for (const m of rest.matchAll(new RegExp(`\\b(${DAY_RE})\\b`, "gi"))) {
    const d = dayOf(m[1]);
    if (d) add([d]);
  }
  return out;
}

type Clock = { h: number; m: number; ap: "am" | "pm" | null };
function clock(raw: string): Clock | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  return { h, m: min, ap: m[3] ? (m[3].startsWith("a") ? "am" : "pm") : null };
}
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
function to24(c: Clock): number {
  if (c.ap === "pm" && c.h < 12) return c.h + 12;
  if (c.ap === "am" && c.h === 12) return 0;
  return c.h;
}

/** "8 to 6", "8am-6pm", "08:00 - 18:00". guessed: a bare hour had to be read as am/pm. */
function segmentTimes(seg: string): { open: string; close: string; guessed: boolean } | null {
  const T = "(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?)";
  const m = seg.toLowerCase().match(new RegExp(`(?:^|[^\\d:])${T}\\s*(?:-|–|—|to|till|until)\\s*${T}(?![\\d:])`));
  if (!m) return null;
  const a = clock(m[1]);
  const b = clock(m[2]);
  if (!a || !b) return null;
  let guessed = false;
  let oh = to24(a);
  let ch = to24(b);
  if (!a.ap && a.h >= 1 && a.h <= 12) {
    // A bare opening hour: 6..12 is morning or noon; 1..5 is a guess at afternoon.
    oh = a.h >= 6 ? a.h : a.h + 12;
    if (a.h < 6) guessed = true;
  }
  if (!b.ap && b.h <= 12) {
    if (b.h * 60 + b.m <= oh * 60 + a.m) {
      ch = b.h === 12 ? 12 : b.h + 12;
      guessed = true;
    }
  }
  if (oh * 60 + a.m >= ch * 60 + b.m || ch > 23) return null;
  return { open: hhmm(oh, a.m), close: hhmm(ch, b.m), guessed };
}

export function parseHoursText(text: string, location = ""): HoursTextResult | null {
  const body = String(text || "").replace(/[\u0000-\u001f]+/g, " ").slice(0, 400);
  if (!body.trim()) return null;
  const schedule = defaultHoursSchedule(location);
  for (const d of DAY_ORDER) schedule.days[d] = null;
  const notes: string[] = [];
  let anyOpen = false;
  let unsure = false;
  let lastOpen: string | null = null;
  // Split on commas, semicolons, new lines and full stops (not the dot inside 8.30).
  const segments = body.split(/[,;\n|]|\.(?!\d)|\band\b(?=\s*(?:mon|tue|wed|thu|fri|sat|sun|week))/i).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    let days = segmentDays(seg);
    const times = segmentTimes(seg);
    if (!days.length && times && !anyOpen && segments.length === 1) {
      days = ["mon", "tue", "wed", "thu", "fri", "sat"];
      unsure = true;
      notes.push("No days were named, so Mon to Sat is a guess.");
    }
    if (!days.length) continue;
    if (/\bclosed\b|\bshut\b|\boff\b/i.test(seg) && !times) {
      for (const d of days) schedule.days[d] = null;
      continue;
    }
    if (/\b24\s*(hours|hrs|\/\s*7)\b|\ball day\b/i.test(seg)) {
      for (const d of days) schedule.days[d] = { open: "00:00", close: "23:59" };
      anyOpen = true;
      continue;
    }
    if (times) {
      for (const d of days) schedule.days[d] = { open: times.open, close: times.close };
      anyOpen = true;
      lastOpen = times.open;
      if (times.guessed) {
        unsure = true;
        notes.push("Check AM and PM.");
      }
      continue;
    }
    if (/\bhalf[\s-]?day\b/i.test(seg)) {
      const open = lastOpen ?? "08:00";
      for (const d of days) schedule.days[d] = { open, close: "13:00" };
      anyOpen = true;
      unsure = true;
      notes.push("Half day is read as until 1 PM.");
      continue;
    }
    unsure = true;
    notes.push("Some days had no time, so they show as closed.");
  }
  if (!anyOpen) return null;
  const note = [...new Set(notes)].join(" ") || null;
  return { schedule, unsure, note };
}
