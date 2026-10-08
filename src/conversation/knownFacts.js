// Facts the profile already holds. These turns do not call Gemini.
// A capacity spike must not be what answers the catalogue or the hours.

const { normalizeServices } = require('./liveKnowledge');
const {
  parseHoursSchedule,
  openClosedStatus,
  eatParts,
} = require('./businessHours');
const { looksLikeOfferAsk, looksLikeNewWork } = require('./fileRead');
const { isMessageOnlyMode } = require('./messageOnly');

const HOURS_ASK_RE =
  /\b(are you open|you open now|opening hours|your hours|what are your hours|what time do you (?:open|close)|when do you (?:open|close)|at what time are you opening|what time are you opening|mko wazi|mnafungua|mnafunga|saa ngapi mna(?:fungua|funga))\b/i;

const DAY_WORD = {
  sunday: 'sun',
  sun: 'sun',
  monday: 'mon',
  mon: 'mon',
  tuesday: 'tue',
  tue: 'tue',
  wednesday: 'wed',
  wed: 'wed',
  thursday: 'thu',
  thu: 'thu',
  friday: 'fri',
  fri: 'fri',
  saturday: 'sat',
  sat: 'sat',
  jumapili: 'sun',
  jumatatu: 'mon',
  jumanne: 'tue',
  jumatano: 'wed',
  alhamisi: 'thu',
  ijumaa: 'fri',
  jumamosi: 'sat',
};

function speakClock(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return String(hhmm || '').trim();
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const ap = hour >= 12 ? 'PM' : 'AM';
  const h12 = ((hour + 11) % 12) + 1;
  if (!minute) return `${h12} ${ap}`;
  return `${h12}:${String(minute).padStart(2, '0')} ${ap}`;
}

function mouthServiceName(name) {
  return String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinSpoken(names, language = 'en') {
  const lang = String(language || '').toLowerCase();
  const conj = lang === 'sw' || lang === 'sheng' ? 'na' : 'and';
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} ${conj} ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, ${conj} ${names[names.length - 1]}`;
}

// "You guys operate until what time?" (HD_ee813bcf6248 t16/t17) and its
// variants. Each form names the business's own open/close/work verb, so a
// visit-time question ("can you come until what time") stays out.
const HOURS_ASK_VARIANTS = [
  /\byou(?:\s+guys|\s+people|\s+all)?\s+(?:operate|operating|open|work|working|close|closing)\s+(?:until|till|til|up\s+to|to)\s+what\s+time\b/i,
  /\b(?:until|till|up\s+to)\s+what\s+time\s+(?:do|are)\s+you(?:\s+guys|\s+people)?\s+(?:operate|operating|open|work|working)\b/i,
  /\bwhat\s+time\s+(?:do|are)\s+you(?:\s+guys|\s+people)?\s+(?:open|opening|close|closing|operate|operating|start|finish)\b/i,
  /\b(?:operating|working|business|opening|closing)\s+(?:hours|times?)\b/i,
  /\bhow\s+late\s+(?:are|do)\s+you\b/i,
  /\bwhen\s+(?:are|do)\s+you(?:\s+guys|\s+people)?\s+(?:open|close|operate)\b/i,
  /\bmna(?:fanya\s+kazi|fungua|funga)\s+(?:mpaka|hadi)\s+saa\s+ngapi\b/i,
  /\b(?:mpaka|hadi)\s+saa\s+ngapi\s+mna(?:fanya\s+kazi|fungua|funga)\b/i,
];

function looksLikeHoursAsk(text) {
  const raw = String(text || '').trim();
  if (!raw || looksLikeNewWork(raw)) return false;
  return HOURS_ASK_RE.test(raw) || HOURS_ASK_VARIANTS.some((re) => re.test(raw));
}

function dayKeyFromText(text, now) {
  const raw = String(text || '').toLowerCase();
  if (/\b(tomorrow|kesho)\b/.test(raw)) {
    const today = eatParts(now).weekday;
    const order = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return order[(order.indexOf(today) + 1) % 7];
  }
  for (const [word, key] of Object.entries(DAY_WORD)) {
    if (new RegExp(`\\b${word}\\b`).test(raw)) return key;
  }
  return eatParts(now).weekday;
}

/**
 * Short hours line from the saved schedule. Empty when this is not an hours ask.
 */
function hoursAskLine(text, profile = {}, language = 'en', now = new Date()) {
  if (!looksLikeHoursAsk(text)) return '';
  const schedule = profile.hoursSchedule;
  const parsed = parseHoursSchedule(schedule);
  const sw = String(language || '').toLowerCase() === 'sw' || String(language || '').toLowerCase() === 'sheng';
  if (!parsed) {
    return sw ? 'Sina masaa kwenye rekodi.' : "I don't have our hours on file.";
  }
  const day = dayKeyFromText(text, now);
  const today = eatParts(now).weekday;
  const window = parsed.days[day];
  const namedDay = day !== today;
  if (!window) {
    return sw
      ? namedDay
        ? 'Tuko fungwa siku hiyo.'
        : 'Tuko fungwa sasa.'
      : namedDay
        ? "We're closed that day."
        : "We're closed today.";
  }
  const open = speakClock(window.open);
  const close = speakClock(window.close);
  if (!namedDay && openClosedStatus(schedule, now) === 'open') {
    return sw ? `Tuko wazi mpaka ${close}.` : `We're open until ${close}.`;
  }
  if (!namedDay && openClosedStatus(schedule, now) === 'closed') {
    return sw
      ? `Tuko fungwa sasa. Tuko wazi ${open} mpaka ${close}.`
      : `We're closed now. We're open ${open} to ${close}.`;
  }
  return sw ? `Tuko wazi ${open} mpaka ${close}.` : `We're open ${open} to ${close}.`;
}

/**
 * Service names already on the file. Notes and parentheses stay off.
 * The spoken catalogue uses the first four, then "and more" / "na zingine".
 * Brain items[] (later PR) replaces this list. Do not invent names here.
 * @param {object} [profile]
 * @param {number} [limit]
 * @returns {{ names: string[], more: boolean }}
 */
function catalogueFileNames(profile = {}, limit = 4) {
  const rows = normalizeServices(profile.servicesCatalog);
  const names = rows.map((row) => mouthServiceName(row.name)).filter(Boolean);
  const cap = Number.isFinite(limit) && limit > 0 ? limit : names.length;
  return { names: names.slice(0, cap), more: names.length > cap };
}

/**
 * Catalogue list when they asked what we offer. Does not include prices.
 * Phase 0 join: na / and before the last name, one breath.
 */
function offerCatalogueLine(text, profile = {}, language = 'en') {
  if (!looksLikeOfferAsk(text) || looksLikeNewWork(text)) return '';
  const sw = String(language || '').toLowerCase() === 'sw' || String(language || '').toLowerCase() === 'sheng';
  const { names, more } = catalogueFileNames(profile);
  if (!names.length) {
    return sw ? 'Niambie unahitaji nini.' : 'Tell me what you need done.';
  }
  const list = joinSpoken(names, language);
  if (isMessageOnlyMode(profile.afterHoursMode)) {
    if (sw) return more ? `Tuna ${list}, na zingine.` : `Tuna ${list}.`;
    return more ? `We offer ${list}, and more.` : `We offer ${list}.`;
  }
  if (sw) {
    return more ? `Tuna ${list}, na zingine. Unahitaji gani?` : `Tuna ${list}. Unahitaji gani?`;
  }
  return more
    ? `We offer ${list}, and more. Which one do you need?`
    : `We offer ${list}. Which one do you need?`;
}

module.exports = {
  looksLikeHoursAsk,
  hoursAskLine,
  offerCatalogueLine,
  catalogueFileNames,
  speakClock,
};
