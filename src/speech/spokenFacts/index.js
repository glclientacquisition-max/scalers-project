'use strict';

// Spoken facts: one renderer for every time, date, day, amount and count the
// Voice agent speaks, from stored values, per language (en, sw, Sheng spoken
// on the English voice). Brain hands Voice a typed line; Voice owns the
// wording.
//
// Contract (agreed with Brain, 2026-10-09):
//   renderFactLine({ template, lang: 'en'|'sw'|'sheng', slots }) -> string|null
//   renderFact(slot, lang) -> string
// Slots: datetime { type:'datetime', iso, tz:'Africa/Nairobi', precision:'day'|'time' },
//        money { type:'money', minor, currency:'KES', mode?:'from'|'fixed'|'range', max_minor? },
//        count { type:'count', n, unit }, or a plain string (names, services, places).
// An unknown template or a missing required slot returns null; Brain then
// falls back to its own src/conversation/factLine.js.
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

function renderDatetime(slot, lang, opts = {}) {
  const at = parseInstant(slot.iso);
  if (!at) return '';
  const now = parseInstant(opts.now) || new Date();
  const p = eatParts(at);
  const n = eatParts(now);
  if (opts.role === 'requested_at') {
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
  const mode = slot.mode || 'fixed';
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

/**
 * One slot as spoken words. Plain strings pass through.
 * @param {string|object} slot
 * @param {'en'|'sw'|'sheng'} lang
 * @param {{ now?: Date|string, role?: string }} [opts] role 'requested_at' speaks when it was asked.
 * @returns {string} '' when the slot cannot be rendered
 */
function renderFact(slot, lang = 'en', opts = {}) {
  const l = langOf(lang);
  if (slot == null) return '';
  if (typeof slot === 'string' || typeof slot === 'number') return String(slot).trim();
  if (typeof slot !== 'object') return '';
  if (slot.type === 'datetime') return renderDatetime(slot, l, opts);
  if (slot.type === 'money') return renderMoney(slot, l);
  if (slot.type === 'count') return renderCount(slot, l);
  return '';
}

const KIND_SW = { visit: 'ziara', hold: 'ombi', quote: 'ombi la bei' };
const STATUS_EN = { requested: 'requested', confirmed: 'confirmed', scheduled: 'scheduled', pending: 'pending' };
const REASK = {
  time: { en: 'What time works for you?', sw: 'Saa ngapi inakufaa?', sheng: 'Time gani inakufaa?' },
  day: { en: 'Which day works for you?', sw: 'Siku gani inakufaa?', sheng: 'Day gani inakufaa?' },
  when: { en: 'What day and time works for you?', sw: 'Siku na saa gani inakufaa?', sheng: 'Day na time gani inakufaa?' },
  place: { en: 'Where should we come?', sw: 'Tuje wapi?', sheng: 'Tukuje wapi?' },
  service: { en: 'Which service do you need?', sw: 'Unahitaji huduma gani?', sheng: 'Unataka service gani?' },
  name: { en: 'May I have your name?', sw: 'Naomba jina lako?', sheng: 'Niambie jina yako?' },
};

/**
 * Templates. Each returns one short sentence, or null when a required slot
 * is missing. s() renders a slot; has() tells whether it rendered.
 */
const TEMPLATES = {
  move_ok: { required: ['service', 'from', 'to'], render: ({ service, from, to }, lang) => ({
    en: `Done, your ${service} visit is moved from ${from} to ${to}.`,
    sw: `Sawa, ziara ya ${service} imehamishwa kutoka ${from} hadi ${to}.`,
    sheng: `Poa, ${service} visit imesongezwa kutoka ${from} hadi ${to}.`,
  })[lang] },
  move_failed: { required: ['service'], render: ({ service }, lang) => ({
    en: `I couldn't move your ${service} visit.`,
    sw: `Sijaweza kuhamisha ziara ya ${service}.`,
    sheng: `Sijaweza ku-move ${service} visit.`,
  })[lang] },
  book_ok: { required: ['service', 'when'], render: ({ service, when, place }, lang) => ({
    en: `I've saved your ${service} visit request for ${when}${place ? `, in ${place}` : ''}.`,
    sw: `Nimehifadhi ombi la ziara ya ${service} ${when}${place ? `, ${place}` : ''}.`,
    sheng: `Nime-save ${service} visit request ${when}${place ? `, ${place}` : ''}.`,
  })[lang] },
  cancel_ok: { required: ['service'], render: ({ service, when }, lang) => ({
    en: `I've cancelled your ${service} visit${when ? ` for ${when}` : ''}.`,
    sw: `Nimeghairi ziara ya ${service}${when ? ` ya ${when}` : ''}.`,
    sheng: `Nime-cancel ${service} visit${when ? ` ya ${when}` : ''}.`,
  })[lang] },
  note_ok: { required: [], render: (_, lang) => ({
    en: "I've noted that for the team.",
    sw: 'Nimeiandikia timu.',
    sheng: 'Nime-note hiyo kwa team.',
  })[lang] },
  file_item: { required: ['kind', 'service'], render: ({ kind, service, when, requested_at: asked, status }, lang, raw) => {
    const k = String(raw.kind || '').toLowerCase();
    if (!KIND_SW[k]) return null;
    if (k === 'visit') {
      const st = STATUS_EN[String(raw.status || '').toLowerCase()];
      return {
        en: `You have a ${service} visit${st ? ` ${st}` : ''}${when ? ` for ${when}` : ''}.`,
        sw: `Una ziara ya ${service}${when ? ` ${when}` : ''}.`,
        sheng: `Uko na ${service} visit${when ? ` ${when}` : ''}.`,
      }[lang];
    }
    const enKind = k === 'quote' ? 'quote request' : 'request';
    return {
      en: `You have a ${service} ${enKind}${asked ? ` from ${asked}` : ''}.`,
      sw: `Una ${KIND_SW[k]} ya ${service}${asked ? ` ulilotuma ${asked}` : ''}.`,
      sheng: `Uko na ${service} ${k === 'quote' ? 'quote' : 'request'}${asked ? ` ya ${asked}` : ''}.`,
    }[lang];
  } },
  requested_when: { required: ['service', 'requested_at'], render: ({ service, requested_at: asked }, lang) => ({
    en: `You asked for the ${service} ${asked}.`,
    sw: `Uliomba ${service} ${asked}.`,
    sheng: `Uli-request ${service} ${asked}.`,
  })[lang] },
  reask_slot: { required: ['slot'], render: (_, lang, raw) => {
    const row = REASK[String(raw.slot || '').toLowerCase()];
    return row ? row[lang] : null;
  } },
};

/**
 * A Brain fact line as one spoken sentence.
 * @param {{ template: string, lang: 'en'|'sw'|'sheng', slots?: object }} line
 * @param {{ now?: Date|string }} [opts]
 * @returns {string|null}
 */
function renderFactLine(line, opts = {}) {
  if (!line || typeof line !== 'object') return null;
  const spec = TEMPLATES[String(line.template || '')];
  if (!spec) return null;
  const lang = langOf(line.lang);
  const raw = line.slots && typeof line.slots === 'object' ? line.slots : {};
  const rendered = {};
  for (const [key, value] of Object.entries(raw)) {
    rendered[key] = renderFact(value, lang, { ...opts, role: key === 'requested_at' ? 'requested_at' : undefined });
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
