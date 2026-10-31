'use strict';

const { resolveBusinessType } = require('./businessType');

const TEAM_DEFAULT_LINE = {
  en: 'Let me check with the team and get back to you.',
  sw: 'Wacha niulize timu kisha nikujulishe.',
};

function langKey(language) {
  const l = String(language || 'en').toLowerCase();
  return l === 'sw' || l === 'sheng' ? 'sw' : 'en';
}

/** @typedef {'general'|'price'|'hours'|'fee'|'pay'} FallbackKind */

const FALLBACK_KINDS = ['general', 'price', 'hours', 'fee', 'pay'];

const DEFAULT_BY_KIND = {
  general: {
    en: TEAM_DEFAULT_LINE.en,
    sw: TEAM_DEFAULT_LINE.sw,
  },
  price: {
    en: "I'll note what you need and the shop will call you back with a price.",
    sw: 'Nitaweka ombi lako na duka litakupigia kwa bei.',
  },
  hours: {
    en: "I'll confirm opening times with the team and call you back.",
    sw: 'Nitahakikisha muda wa kufungua na timu kisha nitakupigia.',
  },
  fee: {
    en: "I'll check whether we deliver to your area and someone will call you back.",
    sw: 'Nitaangalia kama tunafikisha eneo lako na mtu atakupigia.',
  },
  pay: {
    en: "I'll ask the team to call you back with the payment details.",
    sw: 'Timu itakupigia simu kukupa maelezo ya malipo.',
  },
};

function defaultByKindForBusinessType(type) {
  const base = DEFAULT_BY_KIND;
  if (type === 'home_services') {
    return {
      ...base,
      general: {
        en: "I'll check and someone will call you back to arrange it.",
        sw: 'Nitaangalia na mtu atakupigia simu kupanga.',
      },
      price: {
        en: "I'll note what you need and someone will call you back with a price.",
        sw: 'Nitaweka ombi lako na mtu atakupigia simu kwa bei.',
      },
      fee: {
        en: "I'll check whether we cover your area and someone will call you back.",
        sw: 'Nitaangalia kama tunafikisha eneo lako na mtu atakupigia.',
      },
    };
  }
  if (type === 'general') {
    return {
      ...base,
      general: { en: TEAM_DEFAULT_LINE.en, sw: TEAM_DEFAULT_LINE.sw },
      price: {
        en: "I'll note what you need and someone will call you back with a price.",
        sw: 'Nitaweka ombi lako na mtu atakupigia simu kwa bei.',
      },
    };
  }
  return base;
}

function parseByKind(raw) {
  let obj = raw;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  return obj;
}

/**
 * Map lookup() kind to a fallback bucket.
 * @param {string} lookupKind
 * @returns {FallbackKind}
 */
function mapLookupKindToFallbackKind(lookupKind) {
  const key = String(lookupKind || '').toLowerCase();
  const canonical = key === 'area_fee' || key === 'coverage' || key === 'area' ? 'fee' : key;
  if (canonical === 'price') return 'price';
  if (canonical === 'fee') return 'fee';
  if (canonical === 'hours') return 'hours';
  if (canonical === 'pay') return 'pay';
  return 'general';
}

/** Quote-style owner lines (Esga-style) apply to price lookups only. */
function isQuoteStyleFallbackLine(text) {
  const t = String(text || '').toLowerCase();
  return (
    /\bcall you back with a (?:price|quote)\b/.test(t) ||
    /\bshop will call you back\b/.test(t) ||
    /\bnote what you need\b/.test(t) ||
    /\bduka litakupigia\b/.test(t) ||
    /\blitakupigia kwa bei\b/.test(t) ||
    /\bcannot quote\b/.test(t) ||
    /\bcan'?t quote\b/.test(t) ||
    /\bformal quote\b/.test(t)
  );
}

function generalFitsFallbackKind(line, kind) {
  if (!line) return false;
  if (isQuoteStyleFallbackLine(line)) return kind === 'price';
  if (kind === 'general') return true;
  return true;
}

function ownerGeneralLine(byKind, profile, language) {
  const { callbackSafeLine, pickUnknownAnswerLine } = require('./factSheet');
  const key = langKey(language);
  const bucket = byKind && typeof byKind === 'object' ? byKind.general : null;
  if (bucket && typeof bucket === 'object') {
    const fromJson = String(bucket[key] || '').trim() || (key === 'en' ? String(bucket.en || '').trim() : '');
    if (fromJson && callbackSafeLine(fromJson)) return fromJson;
  }
  const picked = pickUnknownAnswerLine(profile || {}, language);
  if (picked.source !== 'default' && callbackSafeLine(picked.text)) return picked.text;
  return '';
}

function lineForKind(byKind, kind, language, profile = null) {
  const { callbackSafeLine } = require('./factSheet');
  const key = langKey(language);
  const bucket = byKind && typeof byKind === 'object' ? byKind[kind] : null;
  const custom = bucket && typeof bucket === 'object' ? String(bucket[key] || '').trim() : '';
  if (custom && callbackSafeLine(custom) && (kind === 'price' || !isQuoteStyleFallbackLine(custom))) return custom;
  const general = ownerGeneralLine(byKind, profile, language);
  if (general && generalFitsFallbackKind(general, kind) && callbackSafeLine(general)) return general;
  const bt = resolveBusinessType(profile || {});
  const fallback = defaultByKindForBusinessType(bt)[kind] || defaultByKindForBusinessType(bt).general;
  return fallback[key] || fallback.en;
}

module.exports = {
  FALLBACK_KINDS,
  DEFAULT_BY_KIND,
  parseByKind,
  mapLookupKindToFallbackKind,
  isQuoteStyleFallbackLine,
  generalFitsFallbackKind,
  lineForKind,
};
