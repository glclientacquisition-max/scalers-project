'use strict';

// BRAIN_TRUSTED_HOURS (off unless exactly 'on'). Aris prod HD_49d726c3dc9b
// (2026-10-18 13:14 EAT, Sunday): the caller said "maybe I can pass by
// tomorrow" and the model said "Tomorrow is Monday and we will be closed."
// The weekly grid on file (owner, hours.weekly_grid) says Monday 09:30-18:00.
// The closed claim came from an owner FAQ ("Are you open on Monday? No, we
// will be closed on Monday.") that contradicts the grid. Then "Tuesday at what
// time will you be open?" and its follow-ups were not read as hours asks, so
// the model's correct 9:30 AM to 6 PM answer was dropped as unsaid_number and
// the caller heard "I don't have that on file" three times.
//
// With the flag on:
// - today and tomorrow are computed in code in Africa/Nairobi;
// - a day or hours ask is answered from the weekly grid with the `hours_on`
//   fact line (closed only when the grid says closed), or `hours_unknown`
//   ("I'll have the team confirm.") when there is no grid; never a guess;
// - a model open/closed claim about a day that contradicts the grid is
//   dropped and replaced by that day's `hours_on` line;
// - an owner FAQ that contradicts the grid is kept out of the prompt.
//
// The weekly grid is the trusted source: an FAQ answer is free text with no
// date, the grid is the structured hours field the owner set.

const { eatParts, parseHoursSchedule } = require('./businessHours');
const { bulletinImpliesClosed } = require('./dailyBulletin');

const FLAG = 'BRAIN_TRUSTED_HOURS';

function trustedHoursEnabled(env = process.env) {
  return String(env[FLAG] || '').trim() === 'on';
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const EN_DAY = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const SW_DAY = { sun: 'Jumapili', mon: 'Jumatatu', tue: 'Jumanne', wed: 'Jumatano', thu: 'Alhamisi', fri: 'Ijumaa', sat: 'Jumamosi' };

// Full day names only. "OnTuesday" / "onMonday" (model text with a lost
// space, HD_49d726c3dc9b t9) still reads: no left word boundary on purpose.
const DAY_WORDS = [
  ['monday', 'mon'], ['tuesday', 'tue'], ['wednesday', 'wed'], ['thursday', 'thu'],
  ['friday', 'fri'], ['saturday', 'sat'], ['sunday', 'sun'],
  ['jumatatu', 'mon'], ['jumanne', 'tue'], ['jumatano', 'wed'], ['alhamisi', 'thu'],
  ['ijumaa', 'fri'], ['jumamosi', 'sat'], ['jumapili', 'sun'],
];
const DAY_RE = new RegExp(`(${DAY_WORDS.map(([w]) => w).join('|')})\\b`, 'gi');
const DAY_OF = Object.fromEntries(DAY_WORDS);
const TODAY_RE = /\b(today|tonight|leo)\b/i;
const TOMORROW_RE = /\b(tomorrow|kesho)\b/i;
const WEEKEND_RE = /\b(weekends?|wikendi)\b/i;
const RANGE_RE = new RegExp(
  `(${DAY_WORDS.map(([w]) => w).join('|')})\\s*(?:to|through|thru|until|till|-|–|hadi|mpaka)\\s*(${DAY_WORDS.map(([w]) => w).join('|')})\\b`,
  'gi'
);

/** Today and tomorrow in Africa/Nairobi, computed in code. */
function nairobiDays(now = new Date()) {
  const today = eatParts(now).weekday;
  const tomorrow = DAY_KEYS[(DAY_KEYS.indexOf(today) + 1) % 7];
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'long' });
  const date = p.format(new Date(now));
  const tomorrowDate = p.format(new Date(new Date(now).getTime() + 86400000));
  return { today, tomorrow, date, tomorrowDate };
}

function expandRange(a, b) {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [a, b];
  const out = [];
  for (let k = i; ; k = (k + 1) % 7) {
    out.push(order[k]);
    if (k === j || out.length > 7) break;
  }
  return out;
}

/** Day keys a text names: today/tomorrow (Nairobi), weekday names, ranges, weekends. */
function daysNamed(text, now = new Date()) {
  const raw = String(text || '');
  const days = new Set();
  const { today, tomorrow } = nairobiDays(now);
  if (TODAY_RE.test(raw)) days.add(today);
  if (TOMORROW_RE.test(raw)) days.add(tomorrow);
  if (WEEKEND_RE.test(raw)) { days.add('sat'); days.add('sun'); }
  let rest = raw;
  for (const hit of raw.matchAll(RANGE_RE)) {
    for (const key of expandRange(DAY_OF[hit[1].toLowerCase()], DAY_OF[hit[2].toLowerCase()])) days.add(key);
    rest = rest.replace(hit[0], ' ');
  }
  for (const hit of rest.matchAll(DAY_RE)) days.add(DAY_OF[hit[1].toLowerCase()]);
  return [...days];
}

/** What the trusted file says for a day: { status: 'open'|'closed'|'unknown', open?, close?, source }. */
function fileDay(profile = {}, dayKey, now = new Date()) {
  const parsed = parseHoursSchedule(profile?.hoursSchedule);
  // Prose hours only ("8 AM to 6 PM"): on file but not per day. Not judged
  // here; the old hours path keeps it (HOURS NOTES in the prompt).
  if (!parsed && String(profile?.businessHours || '').trim()) return { status: 'unverified', source: 'prose' };
  if (!parsed || !dayKey) return { status: 'unknown', source: 'none' };
  const { today } = nairobiDays(now);
  if (dayKey === today && bulletinImpliesClosed(profile?.dailyBulletin, now)) {
    return { status: 'closed', source: 'bulletin' };
  }
  const window = parsed.days[dayKey];
  if (!window) return { status: 'closed', source: 'grid' };
  return { status: 'open', open: window.open, close: window.close, source: 'grid' };
}

// Open / closed claims. "close at 6 PM" is a closing time, not a closed day.
const CLOSED_CLAIM =
  /\b(closed|not\s+open|won'?t\s+be\s+open|will\s+not\s+be\s+open|aren'?t\s+open|are\s+not\s+open|don'?t\s+open|do\s+not\s+open|tumefunga|tutafunga|tumefungwa|tuko\s+fungwa|tutakuwa\s+tumefunga|hatufungui|hatutafungua|hatuko\s+wazi|hatutakuwa\s+wazi|hatufanyi\s+kazi|tuko\s+closed|tutakuwa\s+closed)\b/i;
const OPEN_CLAIM =
  /\b(?:(?:be|are|is|we're|we’re|we\s+are|we'll\s+be|we\s+will\s+be|stay|tuko|tutakuwa|tuta\s*kuwa)\s+(?:open|wazi)|open\s+(?:from|on|at|until|till|between|tomorrow|today)|we\s+open|we're\s+opening|tunafungua|tutafungua|tuko\s+open)\b/i;

function claimIn(clause) {
  if (CLOSED_CLAIM.test(clause)) return 'closed';
  if (OPEN_CLAIM.test(clause)) return 'open';
  return '';
}

function clauses(sentence) {
  return String(sentence || '')
    .split(/\s*(?:[,;]|\bbut\b|\blakini\b|\bila\b|\bhowever\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A model sentence that says a day is open or closed when the trusted file
 * says otherwise, or says it at all when no hours are on file.
 * @returns {null | { day: string, claim: 'open'|'closed', file: object }}
 */
function contradictsFileHours(sentence, profile = {}, now = new Date()) {
  const raw = String(sentence || '');
  if (!claimIn(raw)) return null;
  const whole = daysNamed(raw, now);
  for (const clause of clauses(raw)) {
    const claim = claimIn(clause);
    if (!claim) continue;
    let days = daysNamed(clause, now);
    // "Tomorrow is Monday and we will be closed": the claim clause names no
    // day; the sentence names one day (tomorrow = Monday).
    if (!days.length && whole.length === 1) days = whole;
    for (const day of days) {
      const file = fileDay(profile, day, now);
      if (file.status === 'unverified') continue;
      if (file.status === 'unknown' || file.status !== claim) return { day, claim, file };
    }
  }
  return null;
}

// Day and hours asks the hours regex misses (HD_49d726c3dc9b t9, t10, t12).
const HOURS_VERB = /\b(open|opening|opened|close|closing|closed|operate|operating|work|working|wazi|fungua|funga|mnafungua|mnafunga|mko\s+wazi|mtakuwa\s+wazi|mtafungua)\b/i;
const TIME_ASK = /\b(what\s+time|which\s+time|saa\s+ngapi|until\s+when|from\s+when|mpaka\s+lini)\b/i;
const OPEN_ASK = /\b(?:are|will|would|do)\s+you(?:\s+guys|\s+people)?\s+(?:be\s+)?(?:open|opened|closed|working|operating)\b|\bmko\s+wazi\b|\bmtakuwa\s+wazi\b|\bmnafungua\b|\bmtafungua\b|\bmnafanya\s+kazi\b/i;
const FOLLOW_UP = /^(?:(?:uh|um|like|so|okay|ok|and|but|sasa|na)[,\s]+)*(?:at,?\s+)*(?:at\s+)?(?:what\s+time|saa\s+ngapi|which\s+time)\b[^.!?]{0,30}[?.!—–-]*$/i;

/**
 * The day an hours or day ask is about, or '' when the turn is not one.
 * A bare "at what time?" follows the last hours ask in the previous turns.
 * @param {string} text
 * @param {{ previous?: string[], now?: Date, looksLikeHoursAsk?: Function }} [opts]
 */
function hoursAskDay(text, opts = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const now = opts.now || new Date();
  const { today } = nairobiDays(now);
  // "What time is it?" is the clock, not the hours (trustedFacts owns it).
  if (require('./trustedFacts').callerClockAsk(raw)) return '';
  const asked = (value) =>
    (TIME_ASK.test(value) && HOURS_VERB.test(value)) ||
    OPEN_ASK.test(value) ||
    (typeof opts.looksLikeHoursAsk === 'function' && opts.looksLikeHoursAsk(value));
  if (asked(raw)) return daysNamed(raw, now)[0] || today;
  if (FOLLOW_UP.test(raw) || (TIME_ASK.test(raw) && raw.split(/\s+/).length <= 6)) {
    const previous = Array.isArray(opts.previous) ? opts.previous.slice(-3).reverse() : [];
    for (const prev of previous) {
      if (asked(prev)) return daysNamed(prev, now)[0] || today;
    }
  }
  return '';
}

/**
 * A model sentence on an hours ask for `dayKey`: 'match' when its clocks and
 * numbers are that day's file hours (and it claims nothing against the file),
 * 'mismatch' when it states hours or open/closed the file does not back,
 * '' when it says nothing about hours.
 */
function sentenceVsDay(sentence, profile = {}, dayKey, now = new Date()) {
  const raw = String(sentence || '');
  const { numbersIn } = require('./numberWords');
  const hasClock = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b|\bsaa\s+\w+/i.test(raw);
  const claim = claimIn(raw);
  if (!hasClock && !claim) return '';
  if (contradictsFileHours(raw, profile, now)) return 'mismatch';
  const file = fileDay(profile, dayKey, now);
  if (file.status === 'unverified') return '';
  if (file.status === 'unknown') return 'mismatch';
  if (file.status === 'closed') return hasClock || claim === 'open' ? 'mismatch' : 'match';
  if (!hasClock) return claim === 'closed' ? 'mismatch' : 'match';
  const { fileHoursFacts } = require('./trustedFacts');
  const days = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  days[dayKey] = { open: file.open, close: file.close };
  const facts = fileHoursFacts({ hoursSchedule: { days } });
  if (!facts) return 'mismatch';
  const clockRe = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi;
  for (const hit of raw.matchAll(clockRe)) {
    const h = String(Number(hit[1]));
    const m = hit[2] && hit[2] !== '00' ? `:${hit[2]}` : '';
    const ap = hit[3].replace(/\./g, '').toLowerCase();
    if (!facts.clocks.has(`${h}${m}${ap}`)) return 'mismatch';
  }
  for (const n of numbersIn(raw)) if (!facts.numbers.has(n)) return 'mismatch';
  return 'match';
}

/** A bare "at what time?" that only follows an earlier hours ask. */
function isHoursFollowUp(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || require('./trustedFacts').callerClockAsk(raw)) return false;
  return FOLLOW_UP.test(raw);
}

/** Owner-facing goal for an hours ask: "opening hours on Tuesday", "opening hours". */
function hoursGoalText(text, now = new Date()) {
  const raw = String(text || '');
  if (TOMORROW_RE.test(raw)) return 'opening hours tomorrow';
  if (TODAY_RE.test(raw)) return 'opening hours today';
  const named = [];
  for (const hit of raw.matchAll(DAY_RE)) named.push(DAY_OF[hit[1].toLowerCase()]);
  return named.length ? `opening hours on ${EN_DAY[named[0]]}` : 'opening hours';
}

/** Spoken clock for "HH:MM": "9:30 AM", "6 PM". */
function enClock(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}

function swClock(hhmm) {
  const { speakSwClock } = require('../speech/swahiliTime');
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return speakSwClock(h, m);
}

/**
 * The `hours_on` (or `hours_unknown`) fact line for a day, from the file.
 * @returns {object} a factLine object
 */
function hoursOnFact(profile = {}, dayKey, { lang = 'en', now = new Date() } = {}) {
  const { factLine } = require('./factLine');
  const file = fileDay(profile, dayKey, now);
  if (file.status === 'unknown') {
    return factLine('hours_unknown', {}, { lang, gate: { hours_schedule: null, day: dayKey || null } });
  }
  const { today, tomorrow } = nairobiDays(now);
  const relative = dayKey === today ? 'today' : dayKey === tomorrow ? 'tomorrow' : '';
  const slots = { day: dayKey, status: file.status };
  if (relative) slots.relative = relative;
  if (file.status === 'open') {
    slots.open = file.open;
    slots.close = file.close;
  }
  return factLine('hours_on', slots, { lang, gate: { source: file.source, day: dayKey } });
}

/** Brain fallback wording for hours_on / hours_unknown (Voice's wording wins). */
function hoursFallbackLine(line) {
  const lang = line.lang;
  const s = line.slots || {};
  if (line.template === 'hours_unknown') {
    if (lang === 'sheng') return "Nitaambia team iconfirm.";
    if (lang === 'sw') return 'Nitaomba timu ithibitishe.';
    return "I'll have the team confirm.";
  }
  const relEn = s.relative === 'today' ? 'Today' : s.relative === 'tomorrow' ? 'Tomorrow' : '';
  const relSw = s.relative === 'today' ? 'Leo' : s.relative === 'tomorrow' ? 'Kesho' : '';
  if (lang === 'sw' || lang === 'sheng') {
    const day = relSw ? `${relSw} ${SW_DAY[s.day]}` : SW_DAY[s.day];
    if (s.status === 'closed') return lang === 'sheng' ? `${day} tuko closed.` : `${day} tumefunga.`;
    return lang === 'sheng'
      ? `${day} tuko open ${swClock(s.open)} mpaka ${swClock(s.close)}.`
      : `${day} tuko wazi ${swClock(s.open)} hadi ${swClock(s.close)}.`;
  }
  const day = relEn ? `${relEn}, ${EN_DAY[s.day]},` : `On ${EN_DAY[s.day]}`;
  if (s.status === 'closed') return `${day} we're closed.`;
  return `${day} we're open from ${enClock(s.open)} to ${enClock(s.close)}.`;
}

/** Prompt lines: today/tomorrow in Nairobi and the grid for both days. Empty when off. */
function trustedHoursPromptLines(profile = {}, now = new Date()) {
  if (!trustedHoursEnabled()) return '';
  const { today, tomorrow, date, tomorrowDate } = nairobiDays(now);
  const say = (key) => {
    const file = fileDay(profile, key, now);
    if (file.status === 'unverified') return 'see HOURS NOTES';
    if (file.status === 'unknown') return 'not on file (say the team will confirm)';
    if (file.status === 'closed') return file.source === 'bulletin' ? "closed (Today's update)" : 'closed';
    return `open ${enClock(file.open)} to ${enClock(file.close)}`;
  };
  const lines = [
    `TODAY IN KENYA: ${EN_DAY[today]} ${date}. TOMORROW: ${EN_DAY[tomorrow]} ${tomorrowDate}.`,
    `HOURS BY DAY (owner hours grid; this beats any FAQ or note about which days you open): today ${EN_DAY[today]}: ${say(today)}; tomorrow ${EN_DAY[tomorrow]}: ${say(tomorrow)}.`,
  ];
  const conflicts = conflictingFaqs(profile, now);
  if (conflicts.length) {
    lines.push(
      `IGNORE these FAQ answers about open days; they contradict the hours grid: ${conflicts
        .map((row) => `"${String(row.question || '').trim()}"`)
        .join(', ')}.`
    );
  }
  return lines.join('\n');
}

/** Owner FAQs whose answer says a day is open or closed against the grid. */
function conflictingFaqs(profile = {}, now = new Date()) {
  const rows = Array.isArray(profile?.faqs) ? profile.faqs : [];
  if (!parseHoursSchedule(profile?.hoursSchedule)) return [];
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const q = String(row.question || '');
    const a = String(row.answer || '');
    // A dated note ("today", "tomorrow") is not a standing answer.
    if (TODAY_RE.test(`${q} ${a}`) || TOMORROW_RE.test(`${q} ${a}`)) return false;
    let claim = claimIn(a);
    if (!claim) {
      const asked = claimIn(q.replace(/\b(?:are|will|is)\s+you\s+/i, 'we are '));
      if (/^\s*(?:yes|yeah|ndiyo|ndio)\b/i.test(a)) claim = asked;
      else if (/^\s*(?:no|hapana)\b/i.test(a)) claim = asked === 'open' ? 'closed' : asked === 'closed' ? 'open' : '';
    }
    if (!claim) return false;
    const days = daysNamed(a, now).length ? daysNamed(a, now) : daysNamed(q, now);
    return days.some((day) => {
      const file = fileDay(profile, day, now);
      return file.source === 'grid' && file.status !== claim;
    });
  });
}

module.exports = {
  FLAG,
  trustedHoursEnabled,
  nairobiDays,
  daysNamed,
  fileDay,
  contradictsFileHours,
  hoursAskDay,
  sentenceVsDay,
  isHoursFollowUp,
  hoursGoalText,
  hoursOnFact,
  hoursFallbackLine,
  trustedHoursPromptLines,
  conflictingFaqs,
  enClock,
};
