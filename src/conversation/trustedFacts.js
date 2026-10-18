'use strict';

// Per-turn trusted facts for the speech guard (VOICE_GUARD_TRUSTED_FACTS,
// default ON in code; set VOICE_GUARD_TRUSTED_FACTS=off to restore the old
// guard). The prompt tells the model the current Kenya time and date
// (src/prompts.js CURRENT TIME IN KENYA) and the business hours. The guard
// used to trust only caller speech, the profile and tool results, so a correct
// "saa tisa na dakika hamsini na moja alasiri (3:51 PM)" was dropped as an
// invented number (HD_95e6745c0df1 t21-t25).
//
// One source of truth: every spoken form below is generated from the same
// clock instant the prompt was built from (eatParts, the function behind
// formatEatNowLabel), then read back through the guard's own number and clock
// readers. No form is a hand-copied string.

const { eatParts, formatEatNowLabel, parseHoursSchedule } = require('./businessHours');
const { numbersIn, numberReadingText } = require('./numberWords');
const { normalizeLocations } = require('./businessLocations');
const { speakSwClock, swHourWord } = require('../speech/swahiliTime');

function trustedFactsEnabled(env = process.env) {
  const raw = String(env.VOICE_GUARD_TRUSTED_FACTS == null ? '' : env.VOICE_GUARD_TRUSTED_FACTS).trim();
  if (!raw) return true;
  return !/^(0|false|off|no)$/i.test(raw);
}

// ------------------------------------------------------------------ clocks

function clockKey(hourRaw, minuteRaw, apRaw) {
  const hour = String(Number(hourRaw));
  const minute = minuteRaw == null || minuteRaw === '' ? '' : String(Number(minuteRaw)).padStart(2, '0');
  const ap = String(apRaw || '').replace(/\./g, '').toLowerCase();
  if (!minute || minute === '00') return `${hour}${ap}`;
  return `${hour}:${minute}${ap}`;
}

/** AM/PM clocks in a text. "8 AM" and "8:00 AM" share one key. */
function clockKeys(text) {
  const keys = new Set();
  const raw = numberReadingText(text);
  for (const hit of raw.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi)) {
    keys.add(clockKey(hit[1], hit[2], hit[3]));
  }
  return keys;
}

// ------------------------------------------------------------ number words

const EN_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
function enNumber(n) {
  if (n < 20) return EN_UNITS[n];
  const tens = EN_TENS[Math.floor(n / 10)];
  return n % 10 ? `${tens}-${EN_UNITS[n % 10]}` : tens;
}

const SW_UNIT = ['', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa'];
const SW_TENS = ['', 'kumi', 'ishirini', 'thelathini', 'arobaini', 'hamsini'];
function swNumber(n) {
  if (n < 10) return SW_UNIT[n];
  const tens = SW_TENS[Math.floor(n / 10)];
  return n % 10 ? `${tens} na ${SW_UNIT[n % 10]}` : tens;
}

/** Swahili hour number (1-12) for a 24h hour: (h - 6) mod 12, 0 -> 12. */
function swHourNumber(hour24) {
  return ((((hour24 - 6) % 12) + 12) % 12) || 12;
}

const SW_PERIOD_RANGES = {
  alfajiri: [[3, 7]],
  asubuhi: [[5, 12]],
  mchana: [[12, 16]],
  alasiri: [[13, 17]],
  jioni: [[16, 20]],
  usiku: [[19, 24], [0, 5]],
};

/** Every Swahili period word a listener accepts for this hour. */
function swPeriodsFor(hour24) {
  return Object.entries(SW_PERIOD_RANGES)
    .filter(([, ranges]) => ranges.some(([a, b]) => hour24 >= a && hour24 < b))
    .map(([word]) => word);
}

/**
 * Every spoken form of one wall-clock time. English digits (12h and 24h),
 * English words, the Swahili clock (6-hour offset) with every period word,
 * "dakika N", "na nusu / robo", and "kasoro".
 */
function timeForms(hour24, minute) {
  const h12 = hour24 % 12 || 12;
  const next12 = (hour24 + 1) % 12 || 12;
  const ap = hour24 < 12 ? 'AM' : 'PM';
  const mm = String(minute).padStart(2, '0');
  const forms = [
    `${String(hour24).padStart(2, '0')}:${mm}`,
    `${hour24}:${mm}`,
    `${h12}:${mm} ${ap}`,
    `${h12}:${mm}${ap.toLowerCase()}`,
  ];
  if (minute === 0) {
    forms.push(`${h12} ${ap}`, `${enNumber(h12)} o'clock`, `${enNumber(h12)} ${ap}`);
  } else {
    forms.push(`${enNumber(h12)} ${enNumber(minute)} ${ap}`);
    if (minute === 15) forms.push(`quarter past ${enNumber(h12)}`);
    else if (minute === 30) forms.push(`half past ${enNumber(h12)}`);
    else if (minute === 45) forms.push(`quarter to ${enNumber(next12)}`);
    if (minute < 30) forms.push(`${enNumber(minute)} minutes past ${enNumber(h12)}`);
    if (minute > 30) forms.push(`${enNumber(60 - minute)} minutes to ${enNumber(next12)}`);
  }
  const swNum = swHourNumber(hour24);
  for (const period of swPeriodsFor(hour24)) {
    forms.push(`${speakSwClock(hour24, minute, { period: false })} ${period}`);
    if (minute === 0) forms.push(`saa ${swHourWord(hour24)} kamili ${period}`);
    else forms.push(`saa ${swHourWord(hour24)} na dakika ${swNumber(minute)} ${period}`);
    if (minute > 30) {
      forms.push(`saa ${swHourWord(hour24 + 1)} kasoro dakika ${swNumber(60 - minute)} ${period}`);
    }
    forms.push(`saa ${swNum}${minute ? ` na dakika ${minute}` : ''} ${period}`);
  }
  return forms;
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SW_MONTHS = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
const SW_DAYS = { sun: 'Jumapili', mon: 'Jumatatu', tue: 'Jumanne', wed: 'Jumatano', thu: 'Alhamisi', fri: 'Ijumaa', sat: 'Jumamosi' };

function eatDate(date) {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return { day: shifted.getUTCDate(), month: shifted.getUTCMonth(), year: shifted.getUTCFullYear() };
}

function dateForms(date) {
  const p = eatParts(date);
  const d = eatDate(date);
  const en = EN_MONTHS[d.month];
  const sw = SW_MONTHS[d.month];
  return [
    `${p.weekdayLong}, ${d.day} ${en} ${d.year}`,
    `${p.weekdayLong} ${en} ${d.day}`,
    `${d.day}/${d.month + 1}/${d.year}`,
    `${SW_DAYS[p.weekday]}, tarehe ${d.day} ${sw} ${d.year}`,
    `tarehe ${swNumber(Math.min(d.day, 59))} ${sw}`,
  ];
}

// ------------------------------------------------------------ fact source

function minuteFloor(ms) {
  return Math.floor(ms / 60000) * 60000;
}

/** One instant: its prompt label, its spoken forms, and what the guard reads in them. */
function instantFacts(ms) {
  const date = new Date(ms);
  const p = eatParts(date);
  const forms = [...new Set(timeForms(p.hours, p.minutes))];
  const blob = forms.join(' | ');
  return {
    ms,
    label: formatEatNowLabel(date),
    hour24: p.hours,
    minute: p.minutes,
    forms,
    readings: formReadings(forms),
    numbers: numbersIn(blob),
    clocks: clockKeys(blob),
  };
}

/** What the guard's own readers see in each form, kept per form. */
function formReadings(forms) {
  return forms
    .map((form) => ({ form, numbers: numbersIn(form), clocks: clockKeys(form) }))
    .filter((row) => row.numbers.size || row.clocks.size);
}

/**
 * Hours on file: the 12-hour clock, the 24-hour hour, and the Swahili hour.
 * Only used when the caller asked the hours, so a visit clock is never
 * authorized by the hours (#489).
 */
function fileHoursFacts(profile = {}) {
  const parsed = parseHoursSchedule(profile?.hoursSchedule);
  const clocks = new Set();
  const numbers = new Set(['0']);
  if (!parsed) return null;
  for (const day of Object.values(parsed.days || {})) {
    if (!day) continue;
    for (const hhmm of [day.open, day.close]) {
      const [hRaw, mRaw] = String(hhmm || '').split(':');
      const h24 = Number(hRaw);
      const minute = Number(mRaw || 0);
      if (!Number.isFinite(h24)) continue;
      const h12 = h24 % 12 || 12;
      const ap = h24 < 12 ? 'am' : 'pm';
      clocks.add(clockKey(h12, minute ? String(minute) : '', ap));
      numbers.add(String(h24));
      numbers.add(String(h12));
      if (minute) numbers.add(String(minute));
      const swHour = (h12 + 6) % 12 || 12;
      numbers.add(String(swHour));
      if (swHour > 10) {
        numbers.add('10');
        numbers.add(String(swHour - 10));
      }
    }
  }
  return clocks.size ? { clocks, numbers } : null;
}

/** Counts the prompt derives from a list on file (branches). */
function fileCounts(profile = {}) {
  const locations = normalizeLocations(profile?.businessLocations || profile?.business_locations);
  return locations.length > 1 ? [{ kind: 'locations', n: locations.length }] : [];
}

const cache = new WeakMap();

/**
 * Trusted facts for this turn. Instants: the clock the prompt was built from
 * (state.conversation.promptClockMs, stamped by the server) and the guard's
 * own now. Built once per turn and cached on the state object.
 * @param {{ state?: object, profile?: object, now?: Date|number }} ctx
 */
function trustedFactsFor(ctx = {}) {
  const nowMs = ctx.now != null ? new Date(ctx.now).getTime() : Date.now();
  const conv = ctx.state && typeof ctx.state === 'object' ? ctx.state.conversation : null;
  const promptMs = Number(conv?.promptClockMs) || null;
  const turn = Number(conv?.turnCount || 0);
  const key = `${turn}|${promptMs || ''}|${minuteFloor(nowMs)}`;
  const holder = ctx.state && typeof ctx.state === 'object' ? ctx.state : null;
  if (holder) {
    const hit = cache.get(holder);
    if (hit && hit.key === key && hit.profile === ctx.profile) return hit.facts;
  }
  const minutes = new Set([minuteFloor(nowMs)]);
  if (promptMs) minutes.add(minuteFloor(promptMs));
  const instants = [...minutes].sort((a, b) => b - a).map(instantFacts);
  const date = dateForms(new Date(nowMs));
  const facts = {
    nowMs,
    instants,
    current: instants[0],
    date: { forms: date, readings: formReadings(date), numbers: numbersIn(date.join(' | ')) },
    hours: fileHoursFacts(ctx.profile || {}),
    counts: fileCounts(ctx.profile || {}),
  };
  if (holder) cache.set(holder, { key, profile: ctx.profile, facts });
  return facts;
}

/** The server stamps the instant the system prompt's clock line was built from. */
function stampPromptClock(state, date = new Date()) {
  if (!state || typeof state !== 'object') return;
  state.conversation ||= {};
  state.conversation.promptClockMs = new Date(date).getTime();
}

/** True when the prompt clock is from an earlier minute and the prompt should be rebuilt. */
function promptClockStale(promptAt, now = new Date(), env = process.env) {
  if (!trustedFactsEnabled(env) || !promptAt) return false;
  return minuteFloor(new Date(promptAt).getTime()) !== minuteFloor(new Date(now).getTime());
}

// --------------------------------------------------------- caller asks

const TIME_NOW_ASK = [
  /\bwhat(?:'s|’s| is)\s+(?:the\s+)?time\b/i,
  /\bwhat\s+time\s+is\s+it\b/i,
  /\b(?:tell|give)\s+me\s+the\s+time\b/i,
  /\b(?:know|check|get)\s+the\s+time\b/i,
  /\b(?:the\s+)?(?:current\s+time|time\s+now|time\s+right\s+now)\b/i,
  /\bdo\s+you\s+(?:have|know)\s+the\s+time\b/i,
  /\b(?:ni\s+)?saa\s+ngapi\b/i,
  /\bsaa\s+(?:hizi|hii|ni)\s+(?:ni\s+)?ngapi\b/i,
  /\bngapi\s+time\b/i,
  /\btime\s+(?:ni|iko|sai|saa\s+hii)\s*(?:ngapi|gani|aje|what)\b/i,
  /\b(?:ni\s+)?time\s+gani\b/i,
  /\btime\s+(?:ni\s+)?ngapi\b/i,
];

const DATE_ASK = [
  /\bwhat(?:'s|’s| is)\s+(?:the\s+|today'?s\s+)?date\b/i,
  /\bwhat\s+day\s+is\s+(?:it|today)\b/i,
  /\btarehe\s+(?:ngapi|gani)\b/i,
  /\bleo\s+ni\s+(?:siku\s+gani|tarehe)\b/i,
  /\bdate\s+(?:gani|ni\s+ngapi|ni\s+gani)\b/i,
];

// "what time do you open", "saa ngapi mtakuja" ask for hours or a visit, not the clock.
const NOT_CLOCK_ASK =
  /\b(open|opening|close|closing|\w*fungua|\w*funga|come|coming|\w*kuja|\w*fika|\w*leta|deliver|delivery|book|booking|visit|appointment|ziara|arrive|ready|pick\s*up|tomorrow|kesho|operate|work|working)\b/i;

/** 'time', 'date', or '' for the caller's last turn. */
function callerClockAsk(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || NOT_CLOCK_ASK.test(raw)) return '';
  if (TIME_NOW_ASK.some((re) => re.test(raw))) return 'time';
  if (DATE_ASK.some((re) => re.test(raw))) return 'date';
  return '';
}

const SW_ASK_WORDS =
  /\b(ngapi|gani|wapi|lini|vipi|aje|nini|saa|ni|sai|sasa|leo|tarehe|siku|hii|hizi|iko|je|kwa|bei|pesa|nataka|naomba|niambie|mko|mna|una|tuna)\b/gi;
const EN_ASK_WORDS =
  /\b(what|what's|whats|time|is|it|the|and|how|much|many|when|where|date|day|today|now|please|tell|me|know|do|you|have|price|cost|i|just|want)\b/gi;

/**
 * Language for a code-generated answer: the language the caller asked in.
 * "saa ngapi" is Kiswahili, "ngapi time" is Sheng, "what's the time" is
 * English. Falls back to the call language when the turn carries no signal.
 */
function askLanguage(text, fallback = 'en') {
  const raw = String(text || '').toLowerCase();
  const sw = (raw.match(SW_ASK_WORDS) || []).length;
  const en = (raw.match(EN_ASK_WORDS) || []).length;
  if (sw && en) return 'sheng';
  if (sw) return 'sw';
  if (en) return 'en';
  const lang = String(fallback || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') return lang;
  if (lang === 'mixed') return 'sw';
  return 'en';
}

// ------------------------------------------------------ sentence checks

const CLOCK_CUE =
  /\b(saa|dakika|time|o'?clock|a\.?m\.?|p\.?m\.?|asubuhi|mchana|alasiri|jioni|usiku|alfajiri|kasoro|nusu|robo|kamili|eat)\b|\b\d{1,2}:\d{2}\b/i;
const DATE_CUE =
  /\b(today|date|tarehe|leo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili|january|february|march|april|may|june|july|august|september|october|november|december|januari|februari|machi|aprili|mei|juni|julai|agosti|septemba|oktoba|novemba|desemba)\b/i;
const PRESENT_FRAME =
  /\b(saa\s*hivi|sasa\s+hivi|sasa|sai|saa\s+hii|right\s+now|now|currently|current\s+time|the\s+time\s+is|it(?:'s|’s|\s+is)|ni\s+saa|leo\s+ni|today\s+is)\b/i;
// A clock next to these is an ETA, a price, a stock count, or the hours, never "now".
const NOT_NOW =
  /\b(arrive|arriving|arrival|come|coming|be\s+there|reach|deliver|delivery|ready|until|till|within|after|later|tomorrow|kesho|fika|kufika|atafika|watafika|tutafika|kuja|atakuja|watakuja|tutakuja|baada|mpaka|hadi|open|opens|opening|close|closes|closing|fungua|funga|book|booked|booking|visit|appointment|ziara|ksh|kes|shillings?|bob|bei|price|prices|cost|costs|stock|pieces?|vipande|units?|in\s+\d+\s+minutes?)\b/i;
const LOCATION_CUE = /\b(branch(?:es)?|locations?|shops?|outlets?|stores?|matawi|tawi|maduka|ofisi)\b/i;

/**
 * The sentence's numbers and clocks are whole forms of one fact: every form
 * used appears completely ("saa tisa na dakika hamsini na moja" and "3:51 PM"),
 * and together they cover every number not already trusted. A bag of stray
 * digits ("saa nne na dakika kumi" from "nine minutes to four" and "saa kumi
 * kasoro") does not pass.
 */
function coveredByForms(numbers, clocks, readings, known, allowedClocks) {
  const used = readings.filter(
    (row) => subsetOf(row.numbers, numbers) && subsetOf(row.clocks, clocks)
  );
  if (!used.length) return false;
  const formNumbers = new Set();
  const formClocks = new Set();
  for (const row of used) {
    for (const n of row.numbers) formNumbers.add(n);
    for (const c of row.clocks) formClocks.add(c);
  }
  return subsetOf(numbers, formNumbers, known) && subsetOf(clocks, formClocks, allowedClocks);
}

function subsetOf(values, ...allowed) {
  for (const value of values) {
    if (!allowed.some((set) => set && set.has(value))) return false;
  }
  return true;
}

/**
 * The sentence states the current time (or date) the prompt gave the model,
 * and nothing else numeric that is not already trusted. Needs a clock ask on
 * this turn or a present-time frame ("saa hivi ni", "it's"), and no ETA,
 * price, stock, or hours words.
 * @returns {'' | 'time' | 'date' | 'count'}
 */
function sentenceStatesTrustedFact(sentence, facts, opts = {}) {
  if (!facts) return '';
  const raw = String(sentence || '');
  const numbers = numbersIn(raw);
  const clocks = clockKeys(raw);
  if (!numbers.size && !clocks.size) return '';
  const known = opts.known || new Set();
  const allowedClocks = opts.clocks || new Set();
  const ask = opts.ask || '';
  if (!NOT_NOW.test(raw)) {
    const framed = Boolean(ask) || PRESENT_FRAME.test(raw);
    if (framed && CLOCK_CUE.test(raw)) {
      for (const instant of facts.instants) {
        if (coveredByForms(numbers, clocks, instant.readings, known, allowedClocks)) return 'time';
      }
    }
    if (framed && DATE_CUE.test(raw) && !clocks.size) {
      if (coveredByForms(numbers, clocks, facts.date.readings, known, new Set())) return 'date';
    }
  }
  if (!clocks.size && LOCATION_CUE.test(raw)) {
    for (const count of facts.counts || []) {
      const n = String(count.n);
      if (numbers.has(n) && subsetOf(numbers, new Set([n]), known)) return 'count';
    }
  }
  return '';
}

// ------------------------------------------------------ time-zone words

// "Right now in Kenya, it is 8:00 PM." (HD_cd0c01f28b05): on a sentence that
// states the trusted clock or date, the country, the capital and the zone are
// the time zone, never a service place. Only these words, only on a sentence
// sentenceStatesTrustedFact already passed; every other place still binds.
const TIME_ZONE_PHRASE = new RegExp(
  [
    // English: in/here in/across Kenya, Kenya time, Nairobi time, East Africa(n) time, EAT
    String.raw`\b(?:(?:here|right\s+here|over\s+here)\s+)?(?:in|across|for)\s+(?:all\s+of\s+)?(?:kenya|nairobi|east\s+africa)\b`,
    String.raw`\b(?:kenya(?:n)?|nairobi|east\s+africa(?:n)?)\s+(?:standard\s+)?time\b`,
    String.raw`\b(?:local\s+)?time\s+(?:here\s+)?in\s+(?:kenya|nairobi)\b`,
    String.raw`\beat\b`,
    // Kiswahili / Sheng: huku/hapa/kwetu Kenya, saa za Kenya/Nairobi/Afrika Mashariki, Kenya sasa
    String.raw`\b(?:huku|hapa|kule|kwetu|ndani\s+ya)\s+(?:kenya|nairobi|afrika\s+mashariki)\b`,
    String.raw`\b(?:kwa\s+)?(?:saa|masaa|time)\s+(?:za|ya|wa)\s+(?:kenya|nairobi|afrika\s+mashariki|east\s+africa)\b`,
    String.raw`\b(?:kenya|nairobi)\s+(?:sasa|sai|saa\s+hii|now)\b`,
  ].join('|'),
  'gi'
);
// Bare country/capital words left after the phrases above ("Kenya, it's 8 PM").
const TIME_ZONE_WORD = /\b(?:kenya(?:n)?|nairobi|afrika\s+mashariki|east\s+africa(?:n)?)\b/gi;

/**
 * The sentence with its time-zone words removed, for the place check only.
 * Call it only on a sentence that states a trusted time or date fact.
 */
function maskTimeZonePlaces(sentence) {
  return String(sentence || '')
    .replace(TIME_ZONE_PHRASE, ' ')
    .replace(TIME_ZONE_WORD, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A sentence that reads a clock: a clock cue with a clock or a number in it
 * ("it is 3:00 PM in Kenya", "saa tisa huku Kenya"). Its zone words are the time
 * zone even when the clock is wrong; the number check then judges the clock.
 */
function sentenceReadsClock(sentence) {
  const raw = String(sentence || '');
  if (!CLOCK_CUE.test(raw)) return false;
  return clockKeys(raw).size > 0 || numbersIn(raw).size > 0;
}

/** True when a trusted-fact kind is the clock or the date (zone words allowed). */
function isZoneFactKind(kind) {
  return kind === 'time' || kind === 'date';
}

// ------------------------------------------------------------ fact lines

/** Code-generated answer to "what time is it", in the caller's language. */
function timeFactLine(facts, lang = 'en') {
  const now = facts?.current;
  if (!now) return '';
  const h12 = now.hour24 % 12 || 12;
  const digits = `${h12}:${String(now.minute).padStart(2, '0')} ${now.hour24 < 12 ? 'AM' : 'PM'}`;
  const sw = speakSwClock(now.hour24, now.minute);
  if (lang === 'sw') return `Saa hii ni ${sw}.`;
  if (lang === 'sheng') return `Saa hii ni ${sw}, yaani ${digits}.`;
  return `It's ${digits} in Kenya now.`;
}

/** Code-generated answer to "what's the date", in the caller's language. */
function dateFactLine(facts, lang = 'en') {
  const forms = facts?.date?.forms;
  if (!Array.isArray(forms) || !forms.length) return '';
  if (lang === 'sw' || lang === 'sheng') return `Leo ni ${forms[3]}.`;
  return `Today is ${forms[0]}.`;
}

module.exports = {
  trustedFactsEnabled,
  trustedFactsFor,
  stampPromptClock,
  promptClockStale,
  clockKey,
  clockKeys,
  timeForms,
  dateForms,
  fileHoursFacts,
  callerClockAsk,
  askLanguage,
  sentenceStatesTrustedFact,
  timeFactLine,
  dateFactLine,
  maskTimeZonePlaces,
  isZoneFactKind,
  sentenceReadsClock,
};
