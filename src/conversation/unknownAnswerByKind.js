'use strict';

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
    en: "I'll send payment details on WhatsApp after this call.",
    sw: 'Nitakutumia maelezo ya malipo kwa WhatsApp baada ya simu hii.',
  },
};

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

function lineForKind(byKind, kind, language) {
  const { callbackSafeLine } = require('./factSheet');
  const key = langKey(language);
  const bucket = byKind && typeof byKind === 'object' ? byKind[kind] : null;
  const custom = bucket && typeof bucket === 'object' ? String(bucket[key] || '').trim() : '';
  if (custom && callbackSafeLine(custom)) return custom;
  const fallback = DEFAULT_BY_KIND[kind] || DEFAULT_BY_KIND.general;
  return fallback[key] || fallback.en;
}

module.exports = {
  FALLBACK_KINDS,
  DEFAULT_BY_KIND,
  parseByKind,
  mapLookupKindToFallbackKind,
  lineForKind,
};
