// GIGO fact validators. Pure, no I/O.
//
// Each validator takes the raw stored value and returns either
//   { ok: true, value }                 a usable fact value
//   { ok: false, reason: 'missing' }    nothing stored
//   { ok: false, reason: 'garbage' }    something stored, but not a usable fact
//
// A validator never fills a default. Missing or garbage stays missing, and the
// reader turns it into an unknown that the assistant speaks as "let me confirm".

const MISSING = Object.freeze({ ok: false, reason: 'missing' });
const GARBAGE = Object.freeze({ ok: false, reason: 'garbage' });

// Placeholder text owners, imports, and test fixtures leave behind.
const PLACEHOLDER_RE =
  /^(?:n\/?a|na|nil|none|null|undefined|nan|tbd|tba|tbc|todo|to do|pending|unknown|not sure|\?+|-+|_+|\.+|x+|0+|test(?:ing)?|sample|example|placeholder|lorem(?: ipsum)?.*|asdf.*|qwerty.*|abc|xyz|dummy|default|same|see above|ask|call us|confirm|confirm with (?:the )?(?:team|owner))$/i;

function asText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.replace(/\s+/g, ' ').trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return '';
}

function isPlaceholder(text) {
  const t = asText(text);
  if (!t) return true;
  if (PLACEHOLDER_RE.test(t)) return true;
  // Only punctuation, symbols, or a single character.
  if (!/[\p{L}\p{N}]/u.test(t)) return true;
  if (t.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return true;
  return false;
}

/** Free text such as a policy line, a landmark, or a business name. */
function validateText(raw, { max = 400 } = {}) {
  const text = asText(raw);
  if (!text) return MISSING;
  if (isPlaceholder(text)) return GARBAGE;
  if (text.length > max) return GARBAGE;
  return { ok: true, value: text };
}

const PRICE_MODES = new Set(['fixed', 'from', 'range', 'ask']);
const QUOTE_RE = /\b(quote|quotation|quoted|on site|site visit|bei ya makubaliano|tutakupa bei)\b/i;
const FREE_RE = /\b(free|bure)\b/i;

/**
 * Price text from the owner ("2,500", "KES 1,500 - 3,000", "from 800",
 * "Quoted on site"). A number of zero, a negative number, or a word with no
 * amount and no quote/free wording is garbage. Never parsed into a new amount.
 * @param {unknown} raw  price / price_range text
 * @param {unknown} [mode]  price_mode / pricing_mode
 */
function validatePrice(raw, mode) {
  const text = asText(raw);
  const m = asText(mode).toLowerCase();
  if (!text) {
    // The owner said "ask for a quote" with no amount. That is a fact.
    if (m === 'ask') return { ok: true, value: { text: '', mode: 'ask' } };
    return MISSING;
  }
  if (/^(?:ask|ask for (?:a )?(?:price|quote)|on request|price on request|call (?:us )?for (?:a )?price)$/i.test(text)) {
    return { ok: true, value: { text: '', mode: 'ask' } };
  }
  if (isPlaceholder(text)) return GARBAGE;
  const amounts = (text.match(/-?\d[\d,]*(?:\.\d+)?/g) || []).map((n) =>
    Number(n.replace(/,/g, ''))
  );
  if (amounts.length) {
    if (amounts.some((n) => !Number.isFinite(n) || n < 0)) return GARBAGE;
    if (amounts.every((n) => n === 0) && !FREE_RE.test(text)) return GARBAGE;
    // Implausible for a Kenyan SME line item: more than KES 100 million.
    if (amounts.some((n) => n > 100_000_000)) return GARBAGE;
  } else if (!QUOTE_RE.test(text) && !FREE_RE.test(text)) {
    return GARBAGE;
  }
  const value = { text };
  if (PRICE_MODES.has(m)) value.mode = m;
  else if (!amounts.length && QUOTE_RE.test(text)) value.mode = 'ask';
  return { ok: true, value };
}

/** in_stock: only an explicit yes or no is a fact. Everything else is missing. */
function validateStock(raw) {
  if (raw === true) return { ok: true, value: 'yes' };
  if (raw === false) return { ok: true, value: 'no' };
  const t = asText(raw).toLowerCase();
  if (!t) return MISSING;
  if (['yes', 'true', '1', 'in_stock', 'in stock', 'available', 'ipo', 'iko'].includes(t)) {
    return { ok: true, value: 'yes' };
  }
  if (
    ['no', 'false', '0', 'out', 'out_of_stock', 'out of stock', 'unavailable', 'haipo', 'imeisha'].includes(t)
  ) {
    return { ok: true, value: 'no' };
  }
  // "unknown", "maybe", "?" are honest unknowns, not facts.
  if (['unknown', 'maybe', '?'].includes(t)) return MISSING;
  return GARBAGE;
}

const DURATION_RE =
  /\b(same day|same-day|today|tomorrow|kesho|leo|next day|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|dakika|saa|masaa|siku|wiki|mwezi)\b/i;

/**
 * Lead time / ETA text the owner typed ("2-3 days", "same day in Nairobi").
 * Needs a duration word. A bare number has no unit and is garbage.
 */
function validateEta(raw) {
  const text = asText(raw);
  if (!text) return MISSING;
  if (isPlaceholder(text)) return GARBAGE;
  if (!DURATION_RE.test(text)) return GARBAGE;
  if (text.length > 120) return GARBAGE;
  return { ok: true, value: text };
}

/** Kenya or international phone number. Digits only in the value. */
function validatePhone(raw) {
  const text = asText(raw);
  if (!text) return MISSING;
  const digits = text.replace(/[\s\-().]/g, '');
  if (!/^\+?\d{9,15}$/.test(digits)) return GARBAGE;
  if (/^\+?0+$/.test(digits) || /^(\d)\1+$/.test(digits.replace(/^\+/, ''))) return GARBAGE;
  return { ok: true, value: digits };
}

function validateEmail(raw) {
  const text = asText(raw);
  if (!text) return MISSING;
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(text)) return GARBAGE;
  if (/@(example|test)\./i.test(text)) return GARBAGE;
  return { ok: true, value: text.toLowerCase() };
}

/** Non-empty list after each item passes its own validator. */
function validateList(raw, itemValidator) {
  if (raw == null) return MISSING;
  if (!Array.isArray(raw)) return GARBAGE;
  if (!raw.length) return MISSING;
  const out = [];
  for (const item of raw) {
    const row = itemValidator(item);
    if (row.ok) out.push(row.value);
  }
  if (!out.length) return GARBAGE;
  return { ok: true, value: out };
}

/** One of a closed set. */
function validateEnum(raw, allowed) {
  const t = asText(raw).toLowerCase();
  if (!t) return MISSING;
  return allowed.includes(t) ? { ok: true, value: t } : GARBAGE;
}

module.exports = {
  MISSING,
  GARBAGE,
  asText,
  isPlaceholder,
  validateText,
  validatePrice,
  validateStock,
  validateEta,
  validatePhone,
  validateEmail,
  validateList,
  validateEnum,
};
