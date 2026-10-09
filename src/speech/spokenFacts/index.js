'use strict';

// Spoken facts: one renderer for every time, date, day, amount and count the
// Voice agent speaks, from stored values, per language (en, sw, Sheng spoken
// on the English voice). Brain hands Voice a typed line; Voice owns the
// wording.
//
// Contract: docs/specs/fact-lines.md (Brain, 58f31fb3 on brain/call-fixes-d199).
//   renderFactLine({ template, lang: 'en'|'sw'|'sheng', slots, gate? }) -> string|null
//   renderFact(slot, lang) -> string|null
// Slot types: datetime { iso, precision: 'time'|'day'|'relative', text? },
//             money { minor, max_minor?, currency, mode: 'exact'|'from'|'range' },
//             string / enum (DB text as stored), id (never spoken).
// Templates: visit_open, request_open, requested_at, saved_item, saved_none,
// team_will_confirm, move_ok, visit_updated, confirm_identity_first,
// more_open (5397e87c); past_open, past_row, reask_slot, ask_area and the
// narrowed more_open (current requests only) from 3808c04e. An unknown template or a missing
// required slot returns null; Brain then uses its src/conversation/factLine.js.
// visit_updated never says "moved".
//
// HD_d199dbbf6b79: 09:00 was spoken "saa 9 asubuhi"; Kiswahili is
// "saa tatu asubuhi" (src/conversation/swahiliClock.js).

const { swahiliClock, swahiliPeriod } = require('../../conversation/swahiliClock');
const { numberToSw } = require('../spokenForms');
const { spokenFactsEnabled } = require('./flag');
const { dayCue, timeAskLine } = require('../../conversation/visitTime');

const TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Africa/Nairobi, UTC+3 all year
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SW = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
const PERIOD_EN = { asubuhi: 'morning', mchana: 'afternoon', jioni: 'evening', usiku: 'night' };

function langOf(lang) {
  const value = String(lang || 'en').toLowerCase();
  if (value === 'sw' || value.startsWith('swahili')) return 'sw';
  if (value === 'sheng') return 'sheng';
  return 'en';
}

/** Nairobi wall-clock parts of an instant. */
function eatParts(date) {
  const eat = new Date(date.getTime() + TZ_OFFSET_MS);
  return {
    year: eat.getUTCFullYear(),
    month: eat.getUTCMonth(),
    day: eat.getUTCDate(),
    weekday: eat.getUTCDay(),
    minutes: eat.getUTCHours() * 60 + eat.getUTCMinutes(),
    dayNumber: Math.floor((date.getTime() + TZ_OFFSET_MS) / DAY_MS),
  };
}

function parseInstant(iso) {
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso;
  const date = new Date(String(iso || ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "9 AM", "9:30 AM", "4:47 PM". */
function clockEn(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = ((h + 11) % 12) + 1;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return m ? `${hour12}:${String(m).padStart(2, '0')} ${ampm}` : `${hour12} ${ampm}`;
}

function relativeDay(diff, lang) {
  if (lang === 'en') return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff === -1 ? 'yesterday' : '';
  return diff === 0 ? 'leo' : diff === 1 ? 'kesho' : diff === -1 ? 'jana' : '';
}

function dateWords(p, lang) {
  if (lang === 'sw') return `${WEEKDAY_SW[p.weekday]} tarehe ${p.day} ${MONTH_SW[p.month]}`;
  return `${WEEKDAY_EN[p.weekday]}, ${p.day} ${MONTH_EN[p.month]}`;
}

/** Day part: "kesho Jumamosi", "tomorrow, Saturday", "Tuesday, 13 October". */
function dayPhrase(p, nowParts, lang) {
  const diff = p.dayNumber - nowParts.dayNumber;
  const rel = relativeDay(diff, lang);
  const weekday = lang === 'sw' ? WEEKDAY_SW[p.weekday] : WEEKDAY_EN[p.weekday];
  if (rel) return lang === 'en' ? `${rel}, ${weekday}` : `${rel} ${weekday}`;
  // Within the coming week the weekday is enough; further out, add the date.
  if (diff > 1 && diff < 7) return weekday;
  return dateWords(p, lang);
}

const EN_WEEKDAY_RE = new RegExp(`\\b(${WEEKDAY_EN.join('|')})\\b`, 'g');
const EN_MONTH_RE = new RegExp(`\\b(${MONTH_EN.join('|')})\\b`, 'g');
const EN_CLOCK_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s?[Mm]\b\.?/g;

/** A stored when_text read as is; in Kiswahili its clock and names are Kiswahili. */
function renderWhenText(text, lang) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || lang !== 'sw') return raw;
  return raw
    .replace(EN_CLOCK_RE, (full, h, m, ap) => {
      const hour = Number(h);
      if (!(hour >= 1 && hour <= 12)) return full;
      return swahiliClock(((hour % 12) + (/p/i.test(ap) ? 12 : 0)) * 60 + Number(m || 0));
    })
    .replace(EN_WEEKDAY_RE, (day) => WEEKDAY_SW[WEEKDAY_EN.indexOf(day)])
    .replace(EN_MONTH_RE, (month) => MONTH_SW[MONTH_EN.indexOf(month)]);
}

function renderDatetime(slot, lang, opts = {}) {
  const at = parseInstant(slot.iso);
  if (!at) return renderWhenText(slot.text, lang);
  const now = parseInstant(opts.now) || new Date();
  const p = eatParts(at);
  const n = eatParts(now);
  if (opts.role === 'requested_at' || slot.precision === 'relative') {
    // When the caller asked: "jana jioni" / "yesterday at 4:47 PM".
    const diff = p.dayNumber - n.dayNumber;
    const rel = relativeDay(diff, lang);
    if (lang === 'sw') {
      const period = swahiliPeriod(Math.floor(p.minutes / 60));
      return rel ? `${rel} ${period}` : `${dateWords(p, 'sw')} ${period}`;
    }
    if (lang === 'sheng') return rel ? `${rel} ${clockEn(p.minutes)}` : `${dateWords(p, 'en')}`;
    if (rel) return `${rel} at ${clockEn(p.minutes)}`;
    return `on ${dateWords(p, 'en')}`;
  }
  const day = dayPhrase(p, n, lang);
  if (slot.precision !== 'time') return day;
  if (lang === 'sw') return `${day}, ${swahiliClock(p.minutes)}`;
  if (lang === 'sheng') return `${day}, ${clockEn(p.minutes)}`;
  return `${day}, at ${clockEn(p.minutes)}`;
}

function groupThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function amountWords(minor, lang) {
  const value = Number(minor);
  if (!Number.isFinite(value) || value < 0) return '';
  const shillings = Math.floor(value / 100);
  const cents = Math.round(value % 100);
  if (lang === 'sw') {
    const words = numberToSw(shillings);
    return cents ? `${words} na senti ${numberToSw(cents)}` : words;
  }
  return cents ? `${groupThousands(shillings)}.${String(cents).padStart(2, '0')}` : groupThousands(shillings);
}

function renderMoney(slot, lang) {
  if (String(slot.currency || 'KES').toUpperCase() !== 'KES') return '';
  const low = amountWords(slot.minor, lang);
  if (!low) return '';
  const mode = slot.mode === 'fixed' ? 'exact' : slot.mode || 'exact';
  if (mode === 'range' && slot.max_minor != null) {
    const high = amountWords(slot.max_minor, lang);
    if (!high) return '';
    return lang === 'sw' ? `shilingi ${low} hadi ${high}` : `${low} to ${high} shillings`;
  }
  if (lang === 'sw') return mode === 'from' ? `kuanzia shilingi ${low}` : `shilingi ${low}`;
  return mode === 'from' ? `from ${low} shillings` : `${low} shillings`;
}

function renderCount(slot, lang) {
  const n = Number(slot.n);
  if (!Number.isFinite(n)) return '';
  const unit = String(slot.unit || '').trim();
  if (lang === 'sw') {
    const words = Number.isInteger(n) && n >= 0 ? numberToSw(n) : String(n);
    return unit ? `${unit} ${words}` : words;
  }
  if (!unit) return String(n);
  const plural = n === 1 || /s$/i.test(unit) ? unit : `${unit}s`;
  return `${n} ${plural}`;
}

function isDatetime(slot) {
  return slot.type === 'datetime' || (slot.type == null && !('minor' in slot) && ('iso' in slot || 'text' in slot || 'precision' in slot));
}
function isMoney(slot) {
  return slot.type === 'money' || (slot.type == null && 'minor' in slot);
}

/**
 * One slot as spoken words. Strings pass through; typed slots render from the
 * stored value (shape per docs/specs/fact-lines.md; a legacy `type` is read too).
 * @param {string|object} slot
 * @param {'en'|'sw'|'sheng'} lang
 * @param {{ now?: Date|string, role?: string }} [opts]
 * @returns {string|null} null when the slot cannot be rendered
 */
function renderFact(slot, lang = 'en', opts = {}) {
  const l = langOf(lang);
  if (slot == null) return null;
  let out = '';
  if (typeof slot === 'string' || typeof slot === 'number') out = String(slot).trim();
  else if (typeof slot !== 'object' || Array.isArray(slot)) out = '';
  else if (isDatetime(slot)) out = renderDatetime(slot, l, opts);
  else if (isMoney(slot)) out = renderMoney(slot, l);
  else if (slot.type === 'count') out = renderCount(slot, l);
  return out ? out.replace(/\s+/g, ' ').trim() : null;
}

const by = (lang, rows) => rows[lang];

// Kind nouns a stored request title can carry. Stripped from the item so the
// template's own kind word is the only one spoken.
const REQUEST_KIND_TAIL =
  /(?:\s*[-:,(]\s*|\s+)(?:enquiry|enquiries|inquiry|inquiries|request|requests|callback(?:\s+request)?|call\s*back(?:\s+request)?|ombi|maombi|order)\)?\s*$/i;
const REQUEST_KIND_HEAD =
  /^\s*(?:(?:an?\s+)?(?:open\s+)?(?:enquiry|inquiry|request|callback(?:\s+request)?|ombi|order)\s+(?:about|for|on|of|la|kuhusu|ya)\s+)/i;

/**
 * A request title as the object of "an open enquiry about ...".
 * "Water bowl enquiry" -> "water bowl"; "Enquiry about dog food" -> "dog food".
 * A title that is only a kind noun ("Enquiry") gives '' (the line is not read).
 * @param {string} item
 * @returns {string}
 */
function requestItemPhrase(item) {
  let out = String(item || '').replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '');
  for (let i = 0; i < 2; i += 1) {
    const next = out.replace(REQUEST_KIND_HEAD, '').replace(REQUEST_KIND_TAIL, '').trim();
    if (next === out) break;
    out = next;
  }
  if (!out || /^(?:enquiry|inquiry|request|callback|ombi|order)$/i.test(out)) return '';
  // "Water bowl" reads as a noun mid-sentence; a Title Case Name or an
  // acronym stays as stored.
  const words = out.split(' ');
  const sentenceCase = /^[A-Z][a-z]/.test(words[0]) && words.slice(1).every((w) => !/[A-Z]/.test(w));
  return sentenceCase ? out.charAt(0).toLowerCase() + out.slice(1) : out;
}
const oneOf = (value, allowed) => {
  const v = String(value || '').toLowerCase();
  return allowed.includes(v) ? v : null;
};
const and = (text, pre) => (text ? `${pre}${text}` : '');

/**
 * Templates (docs/specs/fact-lines.md). r: rendered slots; raw: slots as sent.
 * Each returns one short sentence, or null.
 */
const TEMPLATES = {
  visit_open: {
    required: ['job', 'status'],
    render: (r, lang, raw) => {
      const status = oneOf(raw.status, ['requested', 'confirmed']);
      if (!status) return null;
      if (status === 'confirmed') {
        return by(lang, {
          en: `You have a ${r.job} visit confirmed${and(r.when, ' for ')}${and(r.place, ', in ')}.`,
          sw: `Una ziara ya ${r.job} iliyothibitishwa${and(r.when, ', ')}${and(r.place, ', ')}.`,
          sheng: `Uko na ${r.job} visit imeconfirmiwa${and(r.when, ', ')}${and(r.place, ', ')}.`,
        });
      }
      return by(lang, {
        en: `You have a ${r.job} visit request${and(r.when, ' for ')}${and(r.place, ', in ')}.`,
        sw: `Una ombi la ziara ya ${r.job}${and(r.when, ', ')}${and(r.place, ', ')}.`,
        sheng: `Uko na ${r.job} visit request${and(r.when, ', ')}${and(r.place, ', ')}.`,
      });
    },
  },
  // The item is the request title as stored, which often carries the kind
  // already ("Water bowl enquiry"). Said once: "an open enquiry about
  // water bowl", never "open enquiry for Water bowl enquiry" (HD_ceba9d9b3f37).
  request_open: {
    required: ['kind', 'item'],
    render: (r, lang, raw) => {
      const kind = oneOf(raw.kind, ['enquiry', 'callback', 'hold', 'order']);
      if (!kind) return null;
      // A title that is only a kind noun ("Callback request") is said once
      // with no item: "You have a callback request."
      const item = requestItemPhrase(r.item);
      const pre = (word) => (item ? ` ${word} ${item}` : '');
      const when = and(r.when, ', ');
      return by(lang, {
        en: {
          enquiry: `You have an open enquiry${pre('about')}${when}.`,
          callback: `You have a callback request${pre('about')}${when}.`,
          hold: `You have a hold${pre('on')}${when}.`,
          order: `You have an order${pre('for')}${when}.`,
        },
        sw: {
          enquiry: `Una ombi${pre('kuhusu')}${when}.`,
          callback: `Una ombi la kupigiwa simu${pre('kuhusu')}${when}.`,
          hold: item ? `Una ${item} uliyoshikiliwa${when}.` : `Una kitu ulichoshikiliwa${when}.`,
          order: `Una oda${pre('ya')}${when}.`,
        },
        sheng: {
          enquiry: `Uko na enquiry${pre('kuhusu')}${when}.`,
          callback: `Uko na callback request${pre('kuhusu')}${when}.`,
          hold: `Uko na hold${pre('ya')}${when}.`,
          order: `Uko na order${pre('ya')}${when}.`,
        },
      })[kind];
    },
  },
  requested_at: {
    required: ['kind', 'job', 'requested_at'],
    render: (r, lang, raw) => {
      const kind = oneOf(raw.kind, ['visit', 'request']);
      if (!kind) return null;
      return by(lang, {
        en: kind === 'visit' ? `You asked for the ${r.job} visit ${r.requested_at}.` : `You sent the ${r.job} request ${r.requested_at}.`,
        sw: kind === 'visit' ? `Uliomba ziara ya ${r.job} ${r.requested_at}.` : `Ulituma ombi la ${r.job} ${r.requested_at}.`,
        sheng: `Uli-request ${r.job}${kind === 'visit' ? ' visit' : ''} ${r.requested_at}.`,
      });
    },
  },
  saved_item: {
    required: ['kind', 'job'],
    render: (r, lang, raw) => {
      const kind = oneOf(raw.kind, ['visit', 'request']);
      if (!kind) return null;
      if (kind === 'request') {
        return by(lang, {
          en: `I've saved a request for ${r.job}.`,
          sw: `Nimehifadhi ombi la ${r.job}.`,
          sheng: `Nime-save request ya ${r.job}.`,
        });
      }
      // Never "moved", even with moved: true; only move_ok says moved.
      return by(lang, {
        en: `I've saved a ${r.job} visit request${and(r.when, ' for ')}${and(r.place, ', in ')}.`,
        sw: `Nimehifadhi ombi la ziara ya ${r.job}${and(r.when, ', ')}${and(r.place, ', ')}.`,
        sheng: `Nime-save ${r.job} visit request${and(r.when, ', ')}${and(r.place, ', ')}.`,
      });
    },
  },
  saved_none: {
    required: [],
    render: (_, lang) => by(lang, {
      en: "I haven't saved anything new on this call yet.",
      sw: 'Bado sijahifadhi kitu kipya kwenye simu hii.',
      sheng: 'Bado sija-save kitu mpya kwa hii call.',
    }),
  },
  team_will_confirm: {
    required: [],
    render: (_, lang) => by(lang, {
      en: 'The team will confirm the time with you.',
      sw: 'Timu itakuthibitishia muda.',
      sheng: 'Team itaku-confirmia time.',
    }),
  },
  move_ok: {
    required: ['to_when'],
    render: (r, lang) => by(lang, {
      en: `Done, I've moved ${r.job ? `your ${r.job}` : 'that'} visit${and(r.from_when, ' from ')} to ${r.to_when}${and(r.place, ', in ')}.`,
      sw: `Sawa, nimehamisha ziara${and(r.job, ' ya ')}${and(r.from_when, ' kutoka ')} hadi ${r.to_when}${and(r.place, ', ')}.`,
      sheng: `Poa, nime-move ${r.job ? `${r.job} ` : ''}visit${and(r.from_when, ' kutoka ')} hadi ${r.to_when}${and(r.place, ', ')}.`,
    }),
  },
  // Never "moved": the time did not change (place or notes only), or Brain
  // could not pin it to a move.
  visit_updated: {
    required: [],
    render: (r, lang) => {
      if (r.to_when) {
        return by(lang, {
          en: `Okay, I've updated that visit to ${r.to_when}${and(r.place, ', in ')}.`,
          sw: `Sawa, nimesasisha ziara hiyo iwe ${r.to_when}${and(r.place, ', ')}.`,
          sheng: `Poa, nime-update hiyo visit iwe ${r.to_when}${and(r.place, ', ')}.`,
        });
      }
      if (r.place) {
        return by(lang, {
          en: `Okay, I've updated that visit to ${r.place}.`,
          sw: `Sawa, nimesasisha ziara hiyo iwe ${r.place}.`,
          sheng: `Poa, nime-update hiyo visit iwe ${r.place}.`,
        });
      }
      return by(lang, {
        en: "Okay, I've updated that visit.",
        sw: 'Sawa, nimesasisha ziara hiyo.',
        sheng: 'Poa, nime-update hiyo visit.',
      });
    },
  },
  // The caller file is masked (name not confirmed). Brain dropped a "no
  // bookings" claim; this is said instead. ask: true carries the one
  // file-name ask; false means it was already spoken, so no ask here.
  confirm_identity_first: {
    required: [],
    render: (r, lang, raw) => {
      const name = raw.ask === true ? r.name : '';
      if (name) {
        return by(lang, {
          en: `Let me just confirm who I'm speaking with, is this ${name}?`,
          sw: `Wacha nithibitishe kwanza, naongea na ${name}?`,
          sheng: `Wacha ni-confirm kwanza, naongea na ${name}?`,
        });
      }
      return by(lang, {
        en: "Let me just confirm who I'm speaking with first.",
        sw: 'Wacha nithibitishe kwanza naongea na nani.',
        sheng: 'Wacha ni-confirm kwanza naongea na nani.',
      });
    },
  },
  // An open-file read's count of current open rows not read out (Brain's
  // four-request cap, or Voice's read-out cap, src/speech/fileReadOut.js).
  // Past-dated rows are never in it: they are past_open (3808c04e).
  more_open: {
    required: [],
    render: (_, lang, raw) => {
      const n = Number(raw.count);
      if (!Number.isInteger(n) || n < 1) return null;
      if (n === 1) {
        return by(lang, {
          en: 'There is one more open request on file.',
          sw: 'Kuna ombi lingine moja kwenye faili.',
          sheng: 'Kuna request ingine moja kwa file.',
        });
      }
      return by(lang, {
        en: `There are ${n} more open requests on file.`,
        sw: `Kuna maombi mengine ${maCount(n)} kwenye faili.`,
        sheng: `Kuna requests zingine ${n} kwa file.`,
      });
    },
  },
  // Past-dated rows still unconfirmed: a count only, never "open" or
  // "upcoming" (HD_1677e57f73f9 (3)).
  past_open: {
    required: [],
    render: (_, lang, raw) => {
      const n = Number(raw.count);
      if (!Number.isInteger(n) || n < 1) return null;
      if (n === 1) {
        return by(lang, {
          en: 'There is one past-dated request the team still has to confirm.',
          sw: 'Kuna ombi moja la tarehe iliyopita ambalo timu bado haijathibitisha.',
          sheng: 'Kuna request moja ya date imepita ambayo team bado haija-confirm.',
        });
      }
      return by(lang, {
        en: `There are ${n} past-dated requests the team still has to confirm.`,
        sw: `Kuna maombi ${maCount(n)} ya tarehe zilizopita ambayo timu bado haijathibitisha.`,
        sheng: `Kuna requests ${n} za date zimepita ambazo team bado haija-confirm.`,
      });
    },
  },
  // The caller named one past-dated row: it has passed, never "open".
  past_row: {
    required: ['job'],
    render: (r, lang, raw) => {
      if (String(raw.kind || '').toLowerCase() === 'visit') {
        return by(lang, {
          en: `The ${r.job} visit request${and(r.when, ' for ')}${and(r.place, ', ')}${r.place ? ',' : ''} has passed and was not confirmed.`,
          sw: `Ombi la ziara ya ${r.job}${and(r.when, ', ')}${and(r.place, ', ')} limepita na halikuthibitishwa.`,
          sheng: `${r.job} visit request${and(r.when, ', ')}${and(r.place, ', ')} imepita na haikuconfirmiwa.`,
        });
      }
      const item = requestItemPhrase(r.job) || r.job;
      return by(lang, {
        en: `The request about ${item}${r.when ? `, ${r.when},` : ''} has passed and was not confirmed.`,
        sw: `Ombi kuhusu ${item}${and(r.when, ', ')} limepita na halikuthibitishwa.`,
        sheng: `Request ya ${item}${and(r.when, ', ')} imepita na haikuconfirmiwa.`,
      });
    },
  },
  // A rejected create asks for its missing slot, again after a barge-in.
  // slot when: the visit time ask (Brain's timeAskLine, Swahili clock for
  // an ambiguous "saa nane"); slot location: where to come.
  reask_slot: {
    required: [],
    render: (_, lang, raw) => {
      const slot = oneOf(raw.slot, ['when', 'location']);
      if (!slot) return null;
      if (slot === 'location') {
        return by(lang, { en: 'Where should we come?', sw: 'Tuje wapi?', sheng: 'Tukuje wapi?' });
      }
      const hour = Number(raw.pending_hour);
      const pendingHour = Number.isInteger(hour) && hour >= 1 && hour <= 12 ? hour : null;
      const askCount = Number(raw.ask_count) || 1;
      if (lang === 'sheng' && pendingHour == null) {
        const day = dayCue(String(raw.day || ''));
        const daySw = day === 'tomorrow' || day === 'kesho' ? 'kesho' : day === 'today' || day === 'leo' ? 'leo' : 'siku hiyo';
        return askCount >= 2 ? 'Asubuhi ama mchana?' : `Ni time gani ${daySw}?`;
      }
      return timeAskLine({
        when: String(raw.day || ''),
        pendingHour,
        language: lang === 'en' ? 'en' : 'sw',
        askCount,
      });
    },
  },
  // A coverage question with no real place: ask the area, claim nothing.
  ask_area: {
    required: [],
    render: (_, lang) => by(lang, { en: 'Which area are you in?', sw: 'Uko eneo gani?', sheng: 'Uko area gani?' }),
  },
};

// Kiswahili count agreeing with a ma- class noun (maombi): mawili, matatu,
// manne, matano, manane; sita, saba, tisa, kumi and the tens do not change.
const MA_UNITS = { mbili: 'mawili', tatu: 'matatu', nne: 'manne', tano: 'matano', nane: 'manane' };
function maCount(n) {
  const words = numberToSw(n).split(' ');
  const last = words.length - 1;
  if (MA_UNITS[words[last]]) words[last] = MA_UNITS[words[last]];
  return words.join(' ');
}

/**
 * A Brain fact line as one spoken sentence.
 * @param {{ template: string, lang: 'en'|'sw'|'sheng', slots?: object }} line
 * @param {{ now?: Date|string }} [opts]
 * @returns {string|null}
 */
function renderFactLine(line, opts = {}) {
  if (!line || typeof line !== 'object') return null;
  const spec = Object.prototype.hasOwnProperty.call(TEMPLATES, String(line.template || ''))
    ? TEMPLATES[line.template]
    : null;
  if (!spec) return null;
  const lang = langOf(line.lang);
  const raw = line.slots && typeof line.slots === 'object' ? line.slots : {};
  const rendered = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') continue;
    const text = renderFact(value, lang, { ...opts, role: key === 'requested_at' ? 'requested_at' : undefined });
    if (text) rendered[key] = text;
  }
  for (const key of spec.required) {
    if (!rendered[key]) return null;
  }
  const out = spec.render(rendered, lang, raw);
  return typeof out === 'string' && out.trim() ? out.replace(/\s+/g, ' ').trim() : null;
}

module.exports = {
  renderFactLine,
  renderFact,
  spokenFactsEnabled,
  TEMPLATES: Object.keys(TEMPLATES),
  requestItemPhrase,
  clockEn,
  eatParts,
};
