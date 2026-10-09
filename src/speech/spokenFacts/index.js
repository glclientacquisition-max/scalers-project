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
// team_will_confirm, move_ok, visit_updated. An unknown template or a missing
// required slot returns null; Brain then uses its src/conversation/factLine.js.
// visit_updated never says "moved".
//
// HD_d199dbbf6b79: 09:00 was spoken "saa 9 asubuhi"; Kiswahili is
// "saa tatu asubuhi" (src/conversation/swahiliClock.js).

const { swahiliClock, swahiliPeriod } = require('../../conversation/swahiliClock');
const { numberToSw } = require('../spokenForms');
const { spokenFactsEnabled } = require('./flag');

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
  request_open: {
    required: ['kind', 'item'],
    render: (r, lang, raw) => {
      const kind = oneOf(raw.kind, ['enquiry', 'callback', 'hold', 'order']);
      if (!kind) return null;
      const when = and(r.when, ', ');
      return by(lang, {
        en: {
          enquiry: `You have an open enquiry for ${r.item}${when}.`,
          callback: `You have a callback request about ${r.item}${when}.`,
          hold: `You have a hold on ${r.item}${when}.`,
          order: `You have an order for ${r.item}${when}.`,
        },
        sw: {
          enquiry: `Una ombi la ${r.item}${when}.`,
          callback: `Una ombi la kupigiwa simu kuhusu ${r.item}${when}.`,
          hold: `Una ${r.item} uliyoshikiliwa${when}.`,
          order: `Una oda ya ${r.item}${when}.`,
        },
        sheng: {
          enquiry: `Uko na enquiry ya ${r.item}${when}.`,
          callback: `Uko na callback request kuhusu ${r.item}${when}.`,
          hold: `Uko na hold ya ${r.item}${when}.`,
          order: `Uko na order ya ${r.item}${when}.`,
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
      if (raw.moved === true && r.when) {
        return by(lang, {
          en: `I've moved your ${r.job} visit to ${r.when}${and(r.place, ', in ')}.`,
          sw: `Nimehamisha ziara ya ${r.job} hadi ${r.when}${and(r.place, ', ')}.`,
          sheng: `Nime-move ${r.job} visit hadi ${r.when}${and(r.place, ', ')}.`,
        });
      }
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
};

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
  clockEn,
  eatParts,
};
