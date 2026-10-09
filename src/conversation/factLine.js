// Brain fact lines (docs/specs/fact-lines.md). Brain owns the template set,
// slots and gates. Voice owns the wording: renderFactLine / renderFact from
// src/speech/spokenFacts (branch voice/spoken-facts). Until that lands, or when
// it returns null, the fallback wording below is used.

const TZ = 'Africa/Nairobi';

const TEMPLATES = {
  visit_open: { required: ['job', 'status'], optional: ['when', 'place'] },
  request_open: { required: ['kind', 'item'], optional: ['when'] },
  requested_at: { required: ['kind', 'job', 'requested_at'], optional: [] },
  saved_item: { required: ['kind', 'job'], optional: ['when', 'place', 'moved'] },
  saved_none: { required: [], optional: ['next_visit'] },
  team_will_confirm: { required: [], optional: [] },
  move_ok: { required: ['to_when'], optional: ['job', 'from_when', 'place'] },
  visit_updated: { required: [], optional: ['to_when', 'place'] },
};

let voiceRenderer;
function voice() {
  if (voiceRenderer !== undefined) return voiceRenderer;
  try {
    // Optional: Voice's module is not on this branch yet.
    // eslint-disable-next-line global-require
    voiceRenderer = require('../speech/spokenFacts');
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
    voiceRenderer = null;
  }
  return voiceRenderer;
}

function present(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/** A line object, or null when the template is unknown or a required slot is missing. */
function factLine(template, slots = {}, { lang = 'en', gate = {} } = {}) {
  const spec = TEMPLATES[template];
  if (!spec) return null;
  for (const key of spec.required) if (!present(slots[key])) return null;
  const clean = {};
  for (const key of [...spec.required, ...spec.optional]) {
    if (present(slots[key])) clean[key] = slots[key];
  }
  return { template, lang: normLang(lang), slots: clean, gate };
}

function normLang(lang) {
  const value = String(lang || 'en').toLowerCase();
  if (value === 'sheng') return 'sheng';
  if (value === 'sw' || value.startsWith('swahili')) return 'sw';
  return 'en';
}

// ------------------------------------------------------------ datetime fallback

const SW_DAYS = { Monday: 'Jumatatu', Tuesday: 'Jumanne', Wednesday: 'Jumatano', Thursday: 'Alhamisi', Friday: 'Ijumaa', Saturday: 'Jumamosi', Sunday: 'Jumapili' };
const SW_MONTHS = { January: 'Januari', February: 'Februari', March: 'Machi', April: 'Aprili', May: 'Mei', June: 'Juni', July: 'Julai', August: 'Agosti', September: 'Septemba', October: 'Oktoba', November: 'Novemba', December: 'Desemba' };

function ymd(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function parts(date) {
  const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(date);
  return {
    weekday: fmt({ weekday: 'long' }),
    day: fmt({ day: 'numeric' }),
    month: fmt({ month: 'long' }),
    clock: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(date)
      .replace(':00', ''),
  };
}

function dayOffset(date, now) {
  const a = Date.parse(`${ymd(date)}T00:00:00Z`);
  const b = Date.parse(`${ymd(now)}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

const REL = {
  en: { '-1': 'yesterday', 0: 'today', 1: 'tomorrow' },
  sw: { '-1': 'jana', 0: 'leo', 1: 'kesho' },
};

/** Fallback for a datetime slot. Voice's renderFact wins. */
function renderDatetime(slot, lang = 'en', now = new Date()) {
  if (!slot || typeof slot !== 'object') return '';
  const date = slot.iso ? new Date(slot.iso) : null;
  if (!date || Number.isNaN(date.getTime())) return String(slot.text || '').trim();
  const l = normLang(lang) === 'en' ? 'en' : 'sw';
  const p = parts(date);
  const weekday = l === 'sw' ? SW_DAYS[p.weekday] || p.weekday : p.weekday;
  const month = l === 'sw' ? SW_MONTHS[p.month] || p.month : p.month;
  const offset = dayOffset(date, now);
  const rel = REL[l][String(offset)];
  const dated = l === 'sw' ? `${weekday} tarehe ${p.day} ${month}` : `${weekday} ${p.day} ${month}`;
  if (slot.precision === 'day') return rel ? `${rel}, ${weekday}` : dated;
  if (slot.precision === 'relative') {
    if (rel) return l === 'sw' ? `${rel} saa ${p.clock}` : `${rel} at ${p.clock}`;
    return l === 'sw' ? `${dated}, saa ${p.clock}` : `${dated} at ${p.clock}`;
  }
  // 'time'
  if (rel) return `${rel}, ${p.clock}`;
  return `${dated}, ${p.clock}`;
}

function renderSlot(key, value, lang, now) {
  if (value && typeof value === 'object' && ('iso' in value || 'text' in value)) {
    const v = voice();
    const voiced = v && typeof v.renderFact === 'function' ? v.renderFact(value, lang) : null;
    return voiced || renderDatetime(value, lang, now);
  }
  return String(value == null ? '' : value);
}

// ------------------------------------------------------------- line fallback

function fallbackLine(line, now = new Date()) {
  const { template, slots } = line;
  const sw = line.lang !== 'en';
  const s = (key) => (present(slots[key]) ? renderSlot(key, slots[key], line.lang, now) : '');
  const tail = (...bits) => {
    const kept = bits.filter(Boolean);
    return kept.length ? `, ${kept.join(', ')}` : '';
  };
  switch (template) {
    case 'visit_open':
      return sw
        ? `Una ziara ya ${s('job')}${tail(s('when'), s('place'))}.`
        : `You have a ${s('job')} visit request${tail(s('when'), s('place'))}.`;
    case 'request_open': {
      const kind = String(slots.kind || 'enquiry').toLowerCase();
      if (sw) return `Una ${kind === 'hold' ? 'hold' : 'ombi'} la ${s('item')}${tail(s('when'))}.`;
      const label = kind === 'callback' ? 'callback request' : kind;
      return `You have ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label} for ${s('item')}${tail(s('when'))}.`;
    }
    case 'requested_at': {
      const what = slots.kind === 'visit'
        ? sw ? `ziara ya ${s('job')}` : `the ${s('job')} visit`
        : sw ? `ombi la ${s('job')}` : `the ${s('job')} request`;
      return sw ? `Uliomba ${what} ${s('requested_at')}.` : `You asked for ${what} ${s('requested_at')}.`;
    }
    case 'saved_item': {
      const when = s('when');
      const place = s('place');
      if (slots.kind === 'visit') {
        if (sw) return `Nimehifadhi ombi la ziara ya ${s('job')}${tail(when, place)}.`;
        const bits = [when, place].filter(Boolean).join(', ');
        return `I have saved a ${s('job')} visit request${bits ? ` for ${bits}` : ''}.`;
      }
      return sw ? `Nimehifadhi ombi la ${s('job')}.` : `I have saved a request for ${s('job')}.`;
    }
    case 'saved_none':
      return sw ? 'Bado sijahifadhi kitu kipya kwenye simu hii.' : 'I have not saved anything new on this call yet.';
    case 'team_will_confirm':
      return sw ? 'Timu itathibitisha.' : 'The team will confirm it.';
    case 'move_ok':
      if (sw) return `Sawa, nimehamisha ziara${s('job') ? ` ya ${s('job')}` : ''} hadi ${s('to_when')}.`;
      return s('job')
        ? `Okay, I've moved the ${s('job')} visit to ${s('to_when')}.`
        : `Okay, I've moved that visit to ${s('to_when')}.`;
    case 'visit_updated': {
      const when = s('to_when');
      if (sw) return when ? `Sawa, nimebadilisha ziara hiyo iwe ${when}.` : 'Sawa, nimebadilisha ziara hiyo.';
      return when ? `Okay, I've updated that visit to ${when}.` : "Okay, I've updated that visit.";
    }
    default:
      return '';
  }
}

/** Spoken text for a line: Voice's wording, else Brain's fallback. */
function renderLine(line, { now = new Date() } = {}) {
  if (!line) return '';
  const v = voice();
  const voiced = v && typeof v.renderFactLine === 'function' ? v.renderFactLine(line) : null;
  return String(voiced || fallbackLine(line, now) || '').trim();
}

/** Render a list of lines; returns { line, lines } with text on each line object. */
function renderLines(lines, opts = {}) {
  const kept = (Array.isArray(lines) ? lines : []).filter(Boolean);
  const out = kept.map((line) => ({ ...line, text: renderLine(line, opts) })).filter((line) => line.text);
  return { line: out.map((row) => row.text).join(' '), lines: out };
}

/** Test hook: force the Voice module (or null) without touching node_modules. */
function setVoiceRendererForTest(mod) {
  voiceRenderer = mod === undefined ? undefined : mod;
}

module.exports = {
  TEMPLATES,
  factLine,
  renderLine,
  renderLines,
  renderDatetime,
  setVoiceRendererForTest,
};
