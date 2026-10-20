'use strict';
// Spoken catalogue compile. File titles stay the desk source of truth.
// This derives the mouth: group size siblings, speak EN/SW openers, expand
// size tokens so TTS does not read "1 bedroom" as "moja bedroom".
// Same function for every tenant, including ones not yet onboarded.

const { numberToEn, numberToSw } = require('../speech/spokenForms');

const EN_NUM = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
};

const SW_NUM = {
  1: 'moja',
  2: 'mbili',
  3: 'tatu',
  4: 'nne',
  5: 'tano',
  6: 'sita',
  7: 'saba',
  8: 'nane',
  9: 'tisa',
  10: 'kumi',
};

const SW_BEDROOM = {
  1: 'chumba kimoja',
  2: 'vyumba viwili',
  3: 'vyumba vitatu',
  4: 'vyumba vinne',
  5: 'vyumba vitano',
};

const SIZE_RES = [
  { kind: 'bedroom', re: /\b(\d{1,2})\s*-?\s*bedrooms?\b/gi, pack: false },
  { kind: 'seater', re: /\b(\d{1,2})\s*-?\s*seaters?\b/gi, pack: false },
  { kind: 'kg', re: /\b(\d{1,2})\s*-?\s*kgs?\b/gi, pack: false },
  { kind: 'sqft', re: /\b(\d{2,5})\s*-?\s*(?:sq\.?\s*ft|sqft|square feet)\b/gi, pack: false },
  { kind: 'litre', re: /\b(\d{1,4})\s*-?\s*(?:litres?|liters?|ltrs?)\b/gi, pack: false },
  { kind: 'pack', re: /\b(small|medium|large|mini|xl)\b/gi, pack: true },
];

function isSw(language) {
  const lang = String(language || 'en').toLowerCase();
  return lang === 'sw' || lang === 'sheng';
}

function mouthName(name) {
  return String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleHead(word) {
  const w = String(word || '').trim();
  if (!w) return '';
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function joinList(items, language) {
  const list = (items || []).map((x) => String(x || '').trim()).filter(Boolean);
  const conj = isSw(language) ? 'na' : 'and';
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} ${conj} ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, ${conj} ${list[list.length - 1]}`;
}

function speakSize(kind, n, language) {
  const sw = isSw(language);
  const key = String(n || '').toLowerCase();
  if (kind === 'pack') return key;
  const num = Number(n);
  if (kind === 'bedroom') {
    if (sw) return SW_BEDROOM[num] || `bedroom ${SW_NUM[num] || n}`;
    return `${EN_NUM[num] || n} bedroom`;
  }
  if (kind === 'seater') {
    return sw ? `kiti ${SW_NUM[num] || n}` : `${EN_NUM[num] || n} seater`;
  }
  if (kind === 'kg') {
    return sw ? `kilo ${SW_NUM[num] || n}` : `${EN_NUM[num] || n} kilo`;
  }
  if (kind === 'sqft') {
    const words = sw ? numberToSw(num) : numberToEn(num);
    return sw ? `futi za mraba ${words}` : `${words} square feet`;
  }
  if (kind === 'litre') {
    const words = sw ? numberToSw(num) : numberToEn(num);
    return sw ? `lita ${words}` : `${words} litres`;
  }
  if (sw) return SW_NUM[num] || String(n);
  return EN_NUM[num] || String(n);
}

function parseSize(name) {
  const raw = mouthName(name);
  for (const spec of SIZE_RES) {
    spec.re.lastIndex = 0;
    const hit = spec.re.exec(raw);
    if (!hit) continue;
    const token = hit[0];
    const value = spec.pack ? String(hit[1]).toLowerCase() : Number(hit[1]);
    const head = mouthName(raw.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '))
      .replace(/^[,\-–—]\s*|\s*[,\-–—]$/g, '')
      .replace(/\s+,/g, ',')
      .replace(/,\s*$/g, '')
      .trim();
    return { head: head || raw, kind: spec.kind, value, token };
  }
  return { head: raw, kind: '', value: null, token: '' };
}

/**
 * @param {string} name
 * @param {string} [language]
 * @returns {string}
 */
function speakCatalogueName(name, language = 'en') {
  let spoken = mouthName(name);
  if (!spoken) return '';
  const sw = isSw(language);
  spoken = spoken.replace(/\b(\d{1,2})\s*-?\s*bedrooms?\b/gi, (_, raw) => speakSize('bedroom', raw, language));
  spoken = spoken.replace(/\b(\d{1,2})\s*-?\s*seaters?\b/gi, (_, raw) => speakSize('seater', raw, language));
  spoken = spoken.replace(/\b(\d{1,2})\s*-?\s*kgs?\b/gi, (_, raw) => speakSize('kg', raw, language));
  spoken = spoken.replace(/\b(\d{2,5})\s*-?\s*(?:sq\.?\s*ft|sqft|square feet)\b/gi, (_, raw) => speakSize('sqft', raw, language));
  spoken = spoken.replace(/\b(\d{1,4})\s*-?\s*(?:litres?|liters?|ltrs?)\b/gi, (_, raw) => speakSize('litre', raw, language));
  spoken = spoken.replace(/\bper\s+seats?\b/gi, sw ? 'kwa kiti' : 'per seat');
  spoken = spoken.replace(/\b(\d{1,2})\b/g, (raw) => {
    const n = Number(raw);
    return (sw ? SW_NUM[n] : EN_NUM[n]) || raw;
  });
  return spoken.replace(/\s+/g, ' ').trim();
}

function speakCatalogueNames(names, language = 'en') {
  return (Array.isArray(names) ? names : [])
    .map((name) => speakCatalogueName(name, language))
    .filter(Boolean);
}

function catalogRows(profile = {}) {
  const services = Array.isArray(profile.servicesCatalog) ? profile.servicesCatalog : [];
  const products = Array.isArray(profile.productCatalog) ? profile.productCatalog : [];
  const raw = services.length ? services : products;
  return raw
    .map((row) => (typeof row === 'string' ? { name: row } : row || {}))
    .map((row) => ({ ...row, name: mouthName(row.name) }))
    .filter((row) => row.name);
}

function familyLabel(family, language) {
  const sw = isSw(language);
  const head = family.head;
  if (!family.kind || family.members.length < 2) {
    return speakCatalogueName(family.members[0]?.name || head, language);
  }
  const values = family.members.map((m) => m.value);
  const first = values[0];
  const last = values[values.length - 1];
  if (family.kind === 'bedroom') {
    if (sw) {
      return `${head} ya nyumba ya ${speakSize('bedroom', first, 'sw')} hadi ${speakSize('bedroom', last, 'sw')}`;
    }
    return `${head} for ${speakSize('bedroom', first, 'en')} to ${speakSize('bedroom', last, 'en')} homes`;
  }
  if (family.kind === 'seater' || family.kind === 'kg' || family.kind === 'sqft' || family.kind === 'litre') {
    const a = speakSize(family.kind, first, language);
    const b = speakSize(family.kind, last, language);
    return sw ? `${head} ya ${a} hadi ${b}` : `${head} for ${a} to ${b}`;
  }
  if (family.kind === 'pack') {
    const range = joinList(values, language);
    return sw ? `${head} ${range}` : `${head}, ${range}`;
  }
  return speakCatalogueName(head, language);
}

function sizeLabels(family, language) {
  return family.members.map((m) => speakSize(family.kind, m.value, language));
}

function openerFor(labels, more, language, messageOnly) {
  const sw = isSw(language);
  const list = joinList(labels, language);
  if (!list) return sw ? 'Niambie unahitaji nini.' : 'Tell me what you need done.';
  if (messageOnly) {
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

/**
 * Compile the spoken catalogue from the owner's file. No I/O. No invented
 * services. Size siblings become one family. Used by lookup, catalogue mouth,
 * and BA v2.
 * @param {object} [profile]
 * @param {{ limit?: number, messageOnly?: boolean }} [opts]
 */
function compileSpokenCatalogue(profile = {}, opts = {}) {
  const rows = catalogRows(profile);
  const parsed = rows.map((row, index) => ({ ...parseSize(row.name), name: row.name, row, index }));
  const groups = new Map();
  for (const item of parsed) {
    const key = item.kind
      ? `${item.head.toLowerCase()}|${item.kind}`
      : `__solo:${item.index}`;
    if (!groups.has(key)) {
      groups.set(key, { head: titleHead(item.head), kind: item.kind, members: [], first: item.index });
    }
    groups.get(key).members.push(item);
  }
  const families = [...groups.values()].map((family) => {
    if (family.kind === 'bedroom' || family.kind === 'seater' || family.kind === 'kg' || family.kind === 'sqft' || family.kind === 'litre') {
      family.members.sort((a, b) => Number(a.value) - Number(b.value));
    }
    const askSize = Boolean(family.kind) && family.members.length > 1;
    return {
      ...family,
      askSize,
      labelEn: familyLabel(family, 'en'),
      labelSw: familyLabel(family, 'sw'),
    };
  });
  families.sort((a, b) => a.first - b.first);
  const cap = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 4;
  const more = families.length > cap;
  const shown = families.slice(0, cap);
  const labels = (language) => shown.map((f) => (isSw(language) ? f.labelSw : f.labelEn));
  const messageOnly = opts.messageOnly === true;
  return {
    families,
    more,
    labels,
    opener(language) {
      return openerFor(labels(language), more, language, messageOnly);
    },
    familyForName(name) {
      const want = mouthName(name).toLowerCase();
      if (!want) return null;
      return (
        families.find((f) => f.members.some((m) => m.name.toLowerCase() === want)) ||
        families.find((f) => f.head.toLowerCase() === want) ||
        families.find((f) => want.includes(f.head.toLowerCase()) || f.head.toLowerCase().includes(want)) ||
        null
      );
    },
    speakName(name, language) {
      return speakCatalogueName(name, language);
    },
    sizeAsk(family, language) {
      if (!family?.askSize) return '';
      const bits = sizeLabels(family, language);
      if (isSw(language)) {
        if (bits.length === 2) return `${bits[0]} au ${bits[1]}?`;
        return `${bits.slice(0, -1).join(', ')}, au ${bits[bits.length - 1]}?`;
      }
      if (bits.length === 2) return `${titleHead(bits[0])} or ${bits[1]}?`;
      return `${titleHead(bits[0])}, ${bits.slice(1, -1).join(', ')}, or ${bits[bits.length - 1]}?`;
    },
  };
}

module.exports = {
  speakCatalogueName,
  speakCatalogueNames,
  mouthName,
  compileSpokenCatalogue,
  parseSize,
  joinList,
};
