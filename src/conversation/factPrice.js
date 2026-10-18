'use strict';
// Single source of truth for catalogue price parsing and speech-safe rendering.
// Desk contract: pricing_mode + price + price_max; display text in price_range (services) or price (products).

const MAX_KSH = 100_000_000;

const QUOTE_TEXT_RE =
  /^(?:ask|ask for (?:a )?(?:price|quote)|call(?:\s+us)?(?:\s+for (?:a )?(?:price|quote))?|tbd|tba|negotiable|on request|price on request|varies?|depends|n\/?a|nil|none|tbc|pending|unknown|uliza|bei ya maelewano|quoted? on site|quote(?:d)?|quotation)$/i;

const QUOTE_INLINE_RE =
  /\b(?:ask|call us|on request|price on request|bei ya maelewano|uliza|negotiable|varies|depends on)\b/i;

/** @param {unknown} raw */
function parseAmount(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(?:ksh|kes|kshs|sh)\.?\s*/i, '')
    .replace(/\/=/g, '')
    .replace(/\s+/g, '');
  const m = s.match(/^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (m[2] === 'k') n *= 1000;
  if (m[2] === 'm') n *= 1_000_000;
  if (!Number.isFinite(n) || n < 0 || n > MAX_KSH) return null;
  return Math.round(n);
}

/**
 * @typedef {{ kind: 'fixed'|'from'|'range'|'quote'|'unknown', min?: number, max?: number, currency: 'KES' }} NormalisedPrice
 */

/**
 * @param {object} item catalogue / service / product row
 * @returns {NormalisedPrice}
 */
function normalisePrice(item) {
  const currency = 'KES';
  const row = item && typeof item === 'object' ? item : {};

  const mode = String(row.pricing_mode ?? row.pricingMode ?? '').trim().toLowerCase();
  const legacyLo = row.price ?? row.price_range ?? row.priceRange ?? '';
  const legacyHi = row.price_max ?? row.priceMax ?? '';

  if (mode === 'ask' || mode === 'quote') return { kind: 'quote', currency };
  if (mode === 'range') {
    const lo = parseAmount(legacyLo);
    const hi = parseAmount(legacyHi);
    if (lo != null && hi != null && hi >= lo) return { kind: 'range', min: lo, max: hi, currency };
  }
  if (mode === 'from') {
    const lo = parseAmount(legacyLo);
    if (lo != null) return { kind: 'from', min: lo, currency };
  }
  if (mode === 'fixed') {
    const lo = parseAmount(legacyLo);
    if (lo != null) return { kind: 'fixed', min: lo, max: lo, currency };
  }

  const text = String(legacyLo || '').trim();
  if (!text) return { kind: 'unknown', currency };
  if (QUOTE_TEXT_RE.test(text)) return { kind: 'quote', currency };

  const low = text.toLowerCase();
  const cleaned = low
    .replace(/kshs?\.?|kes|\/=/g, ' ')
    .replace(/\b(?:per|a)\s+[a-z0-9²]+|\/\s*[a-z0-9²]+|\beach\b|\bpcs?\b/gi, ' ');

  const range = cleaned.match(/(\d[\d.,]*\s*k?)\s*(?:-|–|—|to)\s*(?:sh)?\s*(\d[\d.,]*\s*k?)(?![a-z])/i);
  if (range) {
    const lo = parseAmount(range[1]);
    const hi = parseAmount(range[2]);
    if (lo != null && hi != null && hi >= lo) return { kind: 'range', min: lo, max: hi, currency };
  }

  const durationMin = /\bmin(?:imum)?\s+\d+\s*(?:hours?|hrs?|days?|months?|mins?|minutes?)\b/i.test(low);
  const from =
    /\b(from|starting|kuanzia)\b/i.test(low) || (/\bmin(?:imum)?\b/i.test(low) && !durationMin);
  const num = cleaned.match(/(\d[\d.,]*(?:\s*k(?![a-z]))?)/i);
  const amount = num ? parseAmount(num[1]) : null;
  if (amount != null) {
    return from
      ? { kind: 'from', min: amount, currency }
      : { kind: 'fixed', min: amount, max: amount, currency };
  }

  if (QUOTE_INLINE_RE.test(low)) return { kind: 'quote', currency };
  return { kind: 'unknown', currency };
}

/** @param {NormalisedPrice} norm */
function priceIsSpeakable(norm) {
  return norm && (norm.kind === 'fixed' || norm.kind === 'from' || norm.kind === 'range');
}

function moneyKsh(n) {
  return `KSh ${Number(n).toLocaleString('en-US')}`;
}

/** Keep owner unit tails ("per seat", "per sq m") off the legacy price string. */
function legacyPriceTail(rawText, coreDisplay, norm) {
  const raw = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!raw || !coreDisplay || norm?.kind === 'range') return coreDisplay;
  const replaced = raw
    .replace(/^(?:from|starting at|starting from|kuanzia)\s+/i, '')
    .replace(/^(?:ksh|kes|kshs|sh)\.?\s*/i, '')
    .replace(/^[\d,]+(?:\.\d+)?(?:\s*k(?![a-z]))?\s*(?:-|–|—|to)\s*[\d,]+(?:\.\d+)?(?:\s*k(?![a-z]))?/i, '')
    .replace(/^[\d,]+(?:\.\d+)?(?:\s*k(?![a-z]))?/i, '')
    .trim();
  if (!replaced || /^[-–—/=]+$/.test(replaced)) return coreDisplay;
  const lead = /^(from|kuanzia)\b/i.test(raw) && /^(from|kuanzia)\b/i.test(coreDisplay) ? '' : '';
  return `${coreDisplay}${lead}${replaced.startsWith('per') || replaced.startsWith('/') ? ' ' : ' '}${replaced}`.replace(
    /\s+/g,
    ' '
  );
}

/**
 * Owner-facing display string for prompts, FACT CARD (speakable rows), and guards.
 * @param {NormalisedPrice} norm
 * @param {'en'|'sw'|string} [language]
 * @param {string} [rawText] legacy owner text for unit tails
 */
function legacyMatchesNorm(rawText, norm) {
  const other = normalisePrice({ price_range: rawText });
  if (!priceIsSpeakable(other) || other.kind !== norm.kind) return false;
  if (other.min !== norm.min) return false;
  if (norm.kind === 'range') return other.max === norm.max;
  return true;
}

function formatPriceDisplay(norm, language = 'en', rawText = '') {
  if (!priceIsSpeakable(norm)) return '';
  const raw = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (
    raw &&
    legacyMatchesNorm(raw, norm) &&
    (/\b(ksh|kes|kshs|sh|bob)\b|\/=/i.test(raw) || /\d\s+to\s+\d/i.test(raw))
  ) {
    return raw;
  }
  const sw = String(language || 'en').toLowerCase() === 'sw' || String(language).toLowerCase() === 'sheng';
  let core;
  switch (norm.kind) {
    case 'fixed':
      core = moneyKsh(norm.min);
      break;
    case 'from':
      core = `${sw ? 'Kuanzia' : 'From'} ${moneyKsh(norm.min)}`;
      break;
    case 'range':
      core = `KSh ${norm.min.toLocaleString('en-US')}-${norm.max.toLocaleString('en-US')}`;
      break;
    default:
      return '';
  }
  return legacyPriceTail(rawText, core, norm);
}

/** FACT CARD line when there is no speakable amount. */
function factSheetPriceNote() {
  return 'not on file (quote on request)';
}

/** Mid-sentence price clause (lowercase From when fact refs on). */
function midSentencePriceDisplay(norm, language = 'en', factRefsOn = false, rawText = '') {
  const text = formatPriceDisplay(norm, language, rawText);
  if (!text) return '';
  return factRefsOn ? text.replace(/^(From|Kuanzia)\b/, (w) => w.toLowerCase()) : text;
}

function legacyPriceText(row) {
  const item = row && typeof row === 'object' ? row : {};
  return String(item.price ?? item.price_range ?? item.priceRange ?? '').trim();
}

/** Words that must never be spoken as a catalogue price. */
const SPOKEN_PLACEHOLDER_RE =
  /\b(?:the )?(?:price|bei)(?:\s+is|\s+ni)?\s+(?:ask|call(?:\s+us)?|tbd|negotiable|on request|varies|uliza|bei ya maelewano)\b/i;

module.exports = {
  parseAmount,
  normalisePrice,
  priceIsSpeakable,
  formatPriceDisplay,
  legacyPriceText,
  factSheetPriceNote,
  midSentencePriceDisplay,
  SPOKEN_PLACEHOLDER_RE,
  MAX_KSH,
};
