'use strict';
// Fact sheet with references (option B, RFC docs/rfcs/speech-check-fact-sheet.md).
// Behind VOICE_FACT_REFS, default off.
//
// Every speakable business fact gets a stable ID: {price.<item>}, {fee.<area>},
// {hours.<day>}, {pay.<method>}. The prompt's FACT CARD lists the IDs. The model
// writes the ID; code puts in the owner's value in the caller's language. A
// fact the owner has not confirmed, or an ID that does not exist, is never
// spoken as a value: that sentence becomes "let me confirm that with the owner
// and get back to you".
//
// Facts come only from live Desk data: Catalogue (services_catalog,
// product_catalog), Locations (service_areas via areaTerms, #769), hours
// (hours_schedule) and Payments & Policies (business_policies.payments). The
// compiled llm_system_prompt is never a fact source (personaOnlyPrompt).
//
// Pure module: no I/O, no env reads except the flag. v2 can reuse it as is.

const { factServices, factProducts, factPolicyMap } = require('./provenance');
const { parseHoursSchedule } = require('./businessHours');

const FLAG_ON = /^(1|true|on|yes)$/i;

/** VOICE_FACT_REFS=on|1|true|yes. Default off. */
function factRefsEnabled(env) {
  return FLAG_ON.test(String((env ? env.VOICE_FACT_REFS : process.env.VOICE_FACT_REFS) || '').trim());
}

const CONFIRM_LINE = {
  en: 'Let me confirm that with the owner and get back to you.',
  sw: 'Wacha nithibitishe hilo na mwenye biashara kisha nikujulishe.',
};

function langKey(language) {
  const l = String(language || 'en').toLowerCase();
  return l === 'sw' || l === 'sheng' ? 'sw' : 'en';
}

/** The owner-confirm line in the caller's language. Never empty. */
function confirmWithOwnerLine(language) {
  return CONFIRM_LINE[langKey(language)];
}

function slug(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function rowKey(row) {
  return `${String(row?.name || '').trim().toLowerCase()}|${String(row?.price || row?.price_range || row?.priceRange || '').trim()}`;
}

function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Owner price text with a currency so the TTS renderer reads it as money. */
function priceText(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/\b(ksh|kes|sh|shillings?|bob)\b|\/=/i.test(text)) return text;
  if (/^\d[\d,]*(?:\s*[-–]\s*\d[\d,]*)?\b/.test(text)) return `KSh ${text}`;
  return text;
}

function clock12(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  let h = Number(m[1]);
  const period = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${m[2]} ${period}`;
}

const EN_DAY = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const SW_DAY = { mon: 'Jumatatu', tue: 'Jumanne', wed: 'Jumatano', thu: 'Alhamisi', fri: 'Ijumaa', sat: 'Jumamosi', sun: 'Jumapili' };
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function addFact(facts, fact) {
  let id = fact.id;
  let n = 2;
  while (facts.has(id)) {
    id = `${fact.id}_${n}`;
    n += 1;
  }
  facts.set(id, { ...fact, id });
}

function catalogueFacts(facts, profile) {
  const fieldMeta = profile.fieldMeta || null;
  const rows = [
    ...asArray(profile.servicesCatalog).map((row) => ({ row, kind: 'service' })),
    ...asArray(profile.productCatalog).map((row) => ({ row, kind: 'product' })),
  ];
  const confirmed = new Set([
    ...factServices(profile.servicesCatalog, fieldMeta).map(rowKey),
    ...factProducts(profile.productCatalog, fieldMeta).map(rowKey),
  ]);
  for (const { row, kind } of rows) {
    const name = String(row?.name || '').trim();
    const price = priceText(row?.price || row?.price_range || row?.priceRange || '');
    const id = slug(name);
    if (!name || !price || !id) continue;
    addFact(facts, {
      id: `price.${id}`,
      kind: 'price',
      source: kind,
      label: name,
      value: price,
      confirmed: confirmed.has(rowKey(row)),
    });
  }
}

function areaFeeFacts(facts, profile) {
  const areas = Array.isArray(profile.areaTerms?.areas) ? profile.areaTerms.areas : [];
  for (const area of areas) {
    const id = slug(area.name || area.id);
    if (!id) continue;
    const free = area.trusted && area.feeMode === 'free';
    const fixed = area.trusted && area.feeMode === 'fixed' && area.feeKsh != null;
    addFact(facts, {
      id: `fee.${id}`,
      kind: 'fee',
      label: area.name,
      feeKind: area.kind === 'travel' ? 'travel' : 'delivery',
      value: fixed ? `KSh ${Number(area.feeKsh).toLocaleString('en-US')}` : free ? 'free' : '',
      free,
      confirmed: Boolean(fixed || free),
    });
  }
}

/** Runs of days with the same hours, Monday first: [{ from, to, open, close }] (open null = closed). */
function weekRuns(parsed) {
  const runs = [];
  for (const key of DAY_ORDER) {
    const day = parsed.days[key];
    const open = day ? clock12(day.open) : null;
    const close = day ? clock12(day.close) : null;
    const last = runs[runs.length - 1];
    if (last && last.open === open && last.close === close) last.to = key;
    else runs.push({ from: key, to: key, open, close });
  }
  return runs;
}

function weekText(runs, sw) {
  const days = sw ? SW_DAY : EN_DAY;
  const span = (r) => (r.from === r.to ? days[r.from] : `${days[r.from]} ${sw ? 'hadi' : 'to'} ${days[r.to]}`);
  return runs
    .map((r) => (r.open ? `${span(r)} ${r.open} ${sw ? 'hadi' : 'to'} ${r.close}` : `${span(r)} ${sw ? 'tumefunga' : 'closed'}`))
    .join(sw ? '; ' : '; ');
}

function hoursFacts(facts, profile) {
  const parsed = parseHoursSchedule(profile.hoursSchedule);
  if (!parsed) return;
  const runs = weekRuns(parsed);
  addFact(facts, {
    id: 'hours.week',
    kind: 'hours',
    day: 'week',
    label: 'Opening hours',
    runs,
    value: weekText(runs, false),
    confirmed: true,
  });
  for (const key of DAY_ORDER) {
    const day = parsed.days[key];
    addFact(facts, {
      id: `hours.${key}`,
      kind: 'hours',
      day: key,
      label: EN_DAY[key],
      open: day ? clock12(day.open) : null,
      close: day ? clock12(day.close) : null,
      value: day ? `${clock12(day.open)} to ${clock12(day.close)}` : 'closed',
      closed: !day,
      confirmed: true,
    });
  }
}

function paymentFacts(facts, profile) {
  const policies = asObject(profile.businessPolicies);
  const pay = asObject(policies?.payments);
  if (!pay) return;
  const split = factPolicyMap(profile.businessPolicies, profile.fieldMeta || null);
  const confirmed = Boolean(String(split.policies?.payment || '').trim());
  const push = (id, label, value, extra = {}) => {
    if (!String(value || '').trim()) return;
    addFact(facts, { id: `pay.${id}`, kind: 'pay', label, value: String(value).trim(), confirmed, ...extra });
  };
  push('mpesa_till', 'M-Pesa till number', pay.mpesa_till);
  const paybill = asObject(pay.mpesa_paybill);
  if (paybill?.business_no) {
    const fixedAccount = (paybill.account_mode || 'fixed') === 'fixed' ? String(paybill.account || '').trim() : '';
    push('mpesa_paybill', 'M-Pesa paybill number', paybill.business_no, { account: fixedAccount, accountMode: paybill.account_mode || 'fixed' });
  }
  push('pochi', 'Pochi la Biashara number', asObject(pay.pochi)?.phone);
  push('mpesa_send', 'M-Pesa send money number', asObject(pay.mpesa_send)?.phone);
  push('airtel_till', 'Airtel Money till', asObject(pay.airtel)?.till);
  push('airtel_phone', 'Airtel Money number', asObject(pay.airtel)?.phone);
}

/**
 * The fact sheet for one tenant profile, in ID order: prices, area fees,
 * hours, payment numbers. Pure.
 * @param {object} profile voice profile (tenantProfile.js)
 * @returns {{ facts: Map<string, object> }}
 */
function buildFactSheet(profile = {}) {
  const facts = new Map();
  catalogueFacts(facts, profile);
  areaFeeFacts(facts, profile);
  hoursFacts(facts, profile);
  paymentFacts(facts, profile);
  return { facts };
}

const SHEETS = new WeakMap();

/** buildFactSheet cached per profile object (one per call). */
function factSheetFor(profile) {
  if (!profile || typeof profile !== 'object') return buildFactSheet({});
  let sheet = SHEETS.get(profile);
  if (!sheet) {
    sheet = buildFactSheet(profile);
    SHEETS.set(profile, sheet);
  }
  return sheet;
}

/** The value as spoken in the caller's language. Digits stay digits: the TTS renderer words them. */
function renderFact(fact, language) {
  const sw = langKey(language) === 'sw';
  if (!fact || !fact.confirmed) return '';
  if (fact.kind === 'fee' && fact.free) return sw ? 'bure' : 'free';
  if (fact.kind === 'hours') {
    if (fact.runs) return weekText(fact.runs, sw);
    if (fact.closed) return sw ? 'tumefunga' : 'closed';
    return sw ? `${fact.open} hadi ${fact.close}` : `${fact.open} to ${fact.close}`;
  }
  if (fact.kind === 'pay' && fact.id.startsWith('pay.mpesa_paybill')) {
    if (fact.account) return sw ? `${fact.value}, akaunti ${fact.account}` : `${fact.value}, account ${fact.account}`;
    return fact.value;
  }
  if (fact.kind === 'price') return priceText(fact.value, sw);
  return fact.value;
}

// "From KSh 2,500" sits mid-sentence after rendering: lower-case the lead
// word, and say it in Swahili for a Swahili caller.
function priceText(value, sw) {
  const text = String(value || '');
  const m = text.match(/^(from|starting at|starting from)\s+/i);
  if (!m) return text;
  return `${sw ? 'kuanzia' : m[1].toLowerCase()} ${text.slice(m[0].length)}`;
}

/** A whole sentence stating one fact, for repair when the model's sentence was dropped. */
function factSentence(fact, language) {
  const sw = langKey(language) === 'sw';
  if (!fact || !fact.confirmed) return confirmWithOwnerLine(language);
  const value = renderFact(fact, language);
  switch (fact.kind) {
    case 'price':
      return sw ? `${fact.label} ni ${value}.` : `${fact.label} is ${value}.`;
    case 'fee': {
      const noun = fact.feeKind === 'travel' ? (sw ? 'Ada ya usafiri' : 'The travel fee') : sw ? 'Ada ya delivery' : 'The delivery fee';
      return sw ? `${noun} hadi ${fact.label} ni ${value}.` : `${noun} to ${fact.label} is ${value}.`;
    }
    case 'hours':
      if (fact.runs) return sw ? `Saa zetu ni ${value}.` : `Our hours are ${value}.`;
      if (fact.closed) return sw ? `Siku ya ${SW_DAY[fact.day]} tumefunga.` : `On ${fact.label} we are closed.`;
      return sw ? `Siku ya ${SW_DAY[fact.day]} tunafungua ${value}.` : `On ${fact.label} we are open ${value}.`;
    case 'pay':
      return sw ? `${fact.label} ni ${value}.` : `The ${fact.label} is ${value}.`;
    default:
      return confirmWithOwnerLine(language);
  }
}

function cardLine(fact) {
  const id = `{${fact.id}}`;
  if (!fact.confirmed) return `${id} ${fact.label}: (owner to confirm)`;
  switch (fact.kind) {
    case 'fee':
      return `${id} ${fact.label} ${fact.feeKind} fee: ${renderFact(fact, 'en')}`;
    case 'hours':
      return `${id} ${fact.label}: ${renderFact(fact, 'en')}`;
    default:
      return `${id} ${fact.label}: ${renderFact(fact, 'en')}`;
  }
}

const CARD_SECTIONS = [
  ['price', 'PRICES'],
  ['fee', 'AREA FEES'],
  ['hours', 'HOURS'],
  ['pay', 'PAYMENT NUMBERS'],
];

/**
 * FACT CARD block for the prompt, or '' when there are no facts. Stable for a
 * business (no clock, no caller data), so it belongs in the cacheable prefix.
 */
function formatFactCard(sheet) {
  const facts = [...(sheet?.facts?.values() || [])];
  if (!facts.length) return '';
  const lines = [
    'FACT CARD (prices, fees, hours and payment numbers: use these IDs):',
    'To say one of these, write its ID in braces exactly as listed, for example "It is {price.example}." The system speaks the value in the caller\'s language.',
    'Never write these amounts, times or numbers yourself, in digits or in words. An ID marked (owner to confirm) is spoken as a promise to confirm with the owner.',
    'If a price, fee, time or number is not listed here, say you will confirm it with the owner. Write the ID only inside a full sentence.',
  ];
  for (const [kind, title] of CARD_SECTIONS) {
    const rows = facts.filter((f) => f.kind === kind);
    if (!rows.length) continue;
    lines.push(`${title}:`);
    for (const fact of rows) lines.push(cardLine(fact));
  }
  return lines.join('\n');
}

const REF_RE = /\{\s*([A-Za-z_]+)\s*\.\s*([A-Za-z0-9_]+)\s*\}/g;
const ANY_BRACE_RE = /\{[^{}]*\}/;

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Put values in for every {kind.id} reference. A sentence holding an
 * unconfirmed or unknown reference (or any other brace text) is dropped and
 * the owner-confirm line is spoken once instead.
 * @returns {{ text: string, used: string[], unconfirmed: string[], unknown: string[], factText: string, changed: boolean }}
 */
function renderFactRefs(text, sheet, opts = {}) {
  const raw = String(text || '');
  const result = { text: raw, used: [], unconfirmed: [], unknown: [], factText: '', changed: false };
  if (!raw.includes('{')) return result;
  const facts = sheet?.facts || new Map();
  const values = [];
  let needConfirm = false;
  const kept = [];
  for (const sentence of splitSentences(raw)) {
    if (!sentence.includes('{')) {
      kept.push(sentence);
      continue;
    }
    let bad = false;
    const rendered = sentence.replace(REF_RE, (match, kind, name) => {
      const id = `${kind.toLowerCase()}.${name.toLowerCase()}`;
      const fact = facts.get(id);
      if (!fact) {
        result.unknown.push(id);
        bad = true;
        return match;
      }
      if (!fact.confirmed) {
        result.unconfirmed.push(id);
        bad = true;
        return match;
      }
      const value = renderFact(fact, opts.language);
      result.used.push(id);
      values.push(value);
      return value;
    });
    if (bad || ANY_BRACE_RE.test(rendered) || /[{}]/.test(rendered)) {
      if (!bad) result.unknown.push('malformed');
      // The confirm line takes the dropped sentence's place, once.
      if (!needConfirm) kept.push(confirmWithOwnerLine(opts.language));
      needConfirm = true;
      continue;
    }
    kept.push(rendered);
  }
  result.text = kept.join(' ');
  result.factText = values.join(' ');
  result.changed = result.text !== raw;
  return result;
}

function words(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
  );
}

const HOURS_WORDS = /\b(open|opens|opening|close|closes|closing|hours|weekdays?|weekends?|every day|daily|tomorrow|today|fungua|tunafungua|funga|tunafunga|saa ngapi|kesho|leo)\b/i;

const DAY_WORDS = {
  mon: /\b(monday|jumatatu)\b/i,
  tue: /\b(tuesday|jumanne)\b/i,
  wed: /\b(wednesday|jumatano)\b/i,
  thu: /\b(thursday|alhamisi)\b/i,
  fri: /\b(friday|ijumaa)\b/i,
  sat: /\b(saturday|jumamosi)\b/i,
  sun: /\b(sunday|jumapili)\b/i,
};

/**
 * The fact a dropped sentence (or the caller's ask) was about: a catalogue
 * item or area named in it, a weekday for hours, or a payment method. Null
 * when nothing on the sheet matches.
 */
function findFactFor(texts, sheet) {
  const hay = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join(' ');
  if (!hay.trim()) return null;
  const bag = words(hay);
  const facts = [...(sheet?.facts?.values() || [])];
  let best = null;
  let bestScore = 0;
  for (const fact of facts) {
    if (fact.kind !== 'price' && fact.kind !== 'fee') continue;
    const label = words(fact.label);
    if (!label.size) continue;
    let hits = 0;
    for (const w of label) if (bag.has(w)) hits += 1;
    const score = hits / label.size;
    if (hits && score > bestScore) {
      best = fact;
      bestScore = score;
    }
  }
  if (best && bestScore >= 0.5) return best;
  for (const [day, re] of Object.entries(DAY_WORDS)) {
    if (re.test(hay)) return facts.find((f) => f.id === `hours.${day}`) || null;
  }
  if (HOURS_WORDS.test(hay)) return facts.find((f) => f.id === 'hours.week') || null;
  if (/\b(till|paybill|pay ?bill|lipa|m-?pesa|pochi|airtel)\b/i.test(hay)) {
    return facts.find((f) => f.kind === 'pay') || null;
  }
  return null;
}

/**
 * Prompt text from the Desk-compiled llm_system_prompt with its fact content
 * removed: knowledge, catalogue, FAQ, hours, location and policy sections are
 * dropped, and any remaining line stating an amount, a clock time or a phone,
 * till or account number is dropped. Tone, identity and rules stay.
 */
const FACT_SECTION = /(knowledge|faq|unknown|service|product|catalog|price|pricing|hours|location|landmark|direction|polic|payment|coverage|delivery|social|team directory|areas?)/i;
const SECTION_HEADER = /^\s*(?:#+\s*)?([A-Z][A-Z0-9 &/()'’,.-]{2,}?)\s*(?:\([^)]*\))?\s*:\s*(.*)$/;
const FACT_LINE =
  /\b(ksh|kes|sh)\.?\s*\d|\d[\d,]*\s*(?:\/=|bob|shillings?)\b|shilingi|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b|\+?254\d{6,}|\b0[17]\d{8}\b|\b\d{5,}\b/i;

function personaOnlyPrompt(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let dropping = false;
  for (const line of lines) {
    const header = SECTION_HEADER.exec(line);
    if (header && !/^\s*-/.test(line)) {
      dropping = FACT_SECTION.test(header[1]);
      if (dropping) continue;
    }
    if (dropping) continue;
    if (FACT_LINE.test(line)) continue;
    out.push(line);
  }
  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return [
    'PERSONA (tone, identity and conversation style only). Business facts in the old compiled prompt were removed: take every price, fee, hour, place and payment number from the FACT CARD and LIVE GROUND TRUTH.',
    body,
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  factRefsEnabled,
  buildFactSheet,
  factSheetFor,
  formatFactCard,
  renderFact,
  renderFactRefs,
  factSentence,
  findFactFor,
  confirmWithOwnerLine,
  personaOnlyPrompt,
};
