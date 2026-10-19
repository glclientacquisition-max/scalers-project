'use strict';
// One fact lookup for prices, area fees, hours, payment numbers and the
// services list. Speech is pre-rendered in the caller's language (Sheng is
// Swahili). A missing or unconfirmed fact is the cannot-answer line, never a
// guess. Pure: no I/O. The caller passes the live tenant profile.

const { readAreaTerms, matchArea } = require('../conversation/areaTerms');
const { pickUnknownAnswerLine, callbackSafeLine, factSheetFor, TEAM_DEFAULT_LINE } = require('../conversation/factSheet');
const { normalisePrice, priceIsSpeakable } = require('../conversation/factPrice');
const { classifyRecord, serviceFieldPath, productFieldPath } = require('../conversation/provenance');
const { catalogRowFactValue, factValueForPath, tenantRowFromProfile } = require('../conversation/factHash');
const { parseHoursSchedule, eatParts, openClosedStatus } = require('../conversation/businessHours');
const { speakMoney, numberToEn } = require('../speech/spokenForms');
const { speakSwClock } = require('../speech/swahiliTime');
const { areaAmbiguity, matchArea: nluMatchArea } = require('./v2/nlu');

const EN_HOUR = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const EN_DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const SW_DIGIT = ['sifuri', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa'];
const EN_DAY = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const SW_DAY = { mon: 'Jumatatu', tue: 'Jumanne', wed: 'Jumatano', thu: 'Alhamisi', fri: 'Ijumaa', sat: 'Jumamosi', sun: 'Jumapili' };
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_WORD = {
  mon: /\b(monday|jumatatu)\b/i,
  tue: /\b(tuesday|jumanne)\b/i,
  wed: /\b(wednesday|jumatano)\b/i,
  thu: /\b(thursday|alhamisi)\b/i,
  fri: /\b(friday|ijumaa)\b/i,
  sat: /\b(saturday|jumamosi)\b/i,
  sun: /\b(sunday|jumapili)\b/i,
};

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

function pick(seed, list) {
  const n = Math.abs(Number(seed) || 0) % list.length;
  return list[n];
}

function swish(language) {
  const l = String(language || 'en').toLowerCase();
  return l === 'sw' || l === 'sheng' || l.startsWith('swahili');
}

function speechOf(result, language) {
  const key = swish(language) ? 'sw' : 'en';
  const speech = result?.speech || {};
  return String(speech[key] || speech.en || '').trim();
}

function safeLine(text, language) {
  const line = String(text || '').trim();
  if (callbackSafeLine(line)) return line;
  return TEAM_DEFAULT_LINE[swish(language) ? 'sw' : 'en'];
}

function fallbackSpeech(profile, lookupKind) {
  const { voiceFallbackByKind } = require('../conversation/deskFeatureFlags');
  if (voiceFallbackByKind() && lookupKind) {
    const { lineForKind, parseByKind, mapLookupKindToFallbackKind } = require('../conversation/unknownAnswerByKind');
    const kind = mapLookupKindToFallbackKind(lookupKind);
    const byKind = parseByKind(profile?.unknownAnswerByKind);
    const en = safeLine(lineForKind(byKind, kind, 'en', profile), 'en');
    const sw = safeLine(lineForKind(byKind, kind, 'sw', profile), 'sw');
    return { en, sw };
  }
  const en = safeLine(pickUnknownAnswerLine(profile || {}, 'en').text, 'en');
  const sw = safeLine(pickUnknownAnswerLine(profile || {}, 'sw').text, 'sw');
  return { en, sw };
}

// Why a lookup ended where it did. Written to the voice turn trace (stage
// 'lookup') so a wrong "unconfirmed" or fallback is one query away.
const DEFAULT_REASON = {
  found: 'match',
  not_on_file: 'not_speakable',
  no_data: 'no_list',
  not_found_in_list: 'no_match',
  unconfirmed: 'not_confirmed',
  ambiguous: 'several_matches',
};

function resultOf(status, extra, profile, lookupKind = 'general') {
  const speech = extra.speech || fallbackSpeech(profile, lookupKind);
  return {
    status,
    id: extra.id || '',
    value: extra.value == null ? null : extra.value,
    speech: { en: safeLine(speech.en, 'en'), sw: safeLine(speech.sw, 'sw') },
    options: extra.options || null,
    source: extra.source || '',
    confirmedAt: extra.confirmedAt || null,
    valueHash: extra.valueHash || null,
    reason: extra.reason || DEFAULT_REASON[status] || '',
  };
}

function notOnFile(profile, id, reason, lookupKind = 'general') {
  return resultOf('not_on_file', { id, reason }, profile, lookupKind);
}

/** The list itself was never saved. Never speak that as "we don't do this". */
function noData(profile, id, lookupKind = 'general') {
  return resultOf('no_data', { id }, profile, lookupKind);
}

/**
 * The list exists and this item is not on it. The callback line, unless the
 * business explicitly opted out of anything off the list.
 */
function notFoundInList(profile, id, optOutSpeech, lookupKind = 'general') {
  const extra = optOutSpeech ? { id, speech: optOutSpeech } : { id };
  return resultOf('not_found_in_list', extra, profile, lookupKind);
}

/**
 * Same confirm decision the price rows use: tenant_field_meta plus the fact
 * hash when FACT_HASH_MODE is on. In-data hints do not confirm in hash mode.
 * @returns {boolean}
 */
function factIsConfirmed(profile, fieldPath, value, row) {
  return confirmReading(profile, fieldPath, value, row).ok;
}

/**
 * The confirm decision plus why. Reasons: confirmed, hash_no_row,
 * hash_missing, hash_mismatch, not_owner (source), or not_confirmed.
 * @returns {{ ok: boolean, reason: string }}
 */
function confirmReading(profile, fieldPath, value, row) {
  const reading = classifyRecord(row && typeof row === 'object' ? row : {}, {
    packSeed: false,
    fieldMeta: profile?.fieldMeta || null,
    fieldPath: fieldPath || '',
    value,
  });
  if (reading.fact === true) return { ok: true, reason: 'confirmed' };
  if (reading.hashCheck) return { ok: false, reason: `hash_${reading.hashCheck}` };
  if (reading.source && reading.source !== 'owner') return { ok: false, reason: `source_${reading.source}` };
  return { ok: false, reason: 'not_confirmed' };
}

function optedOutOfUnlisted(profile, kind) {
  const bag = asObject(profile?.lookupOptOut) || {};
  if (bag[kind] === true || bag.all === true) return true;
  if (kind !== 'fee') return false;
  const areas = asObject(profile?.service_areas) || asObject(profile?.serviceAreas);
  return areas?.decline_unlisted === true;
}

function unconfirmed(profile, id, source, reason, lookupKind = 'general') {
  return resultOf('unconfirmed', { id, source, reason }, profile, lookupKind);
}

function termsFor(profile) {
  if (profile?.areaTerms?.areas?.length) return profile.areaTerms;
  const raw = profile?.service_areas || profile?.serviceAreas;
  if (!raw) return null;
  return readAreaTerms(raw, {
    vertical: profile.vertical,
    env: { VOICE_AREA_FEES: 'on' },
  });
}

function sheetFor(profile, terms) {
  // A copy so the fact-sheet cache does not stick a mutated live profile.
  return factSheetFor({ ...profile, areaTerms: terms || profile.areaTerms || null });
}

function both(en, sw) {
  return { en, sw };
}

function joinAnd(items, andWord) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} ${andWord} ${items[items.length - 1]}`;
}

/** Speech from factPrice.normalisePrice only. Never reads the legacy price string. */
function speakNormalisedPrice(norm, lang) {
  if (!priceIsSpeakable(norm)) return '';
  const sw = lang === 'sw';
  if (norm.kind === 'range') {
    if (!Number.isFinite(norm.min) || !Number.isFinite(norm.max)) return '';
    return `${speakMoney(norm.min, lang)} ${sw ? 'hadi' : 'to'} ${speakMoney(norm.max, lang)}`;
  }
  if (!Number.isFinite(norm.min)) return '';
  const body = speakMoney(norm.min, lang);
  if (norm.kind === 'from') return `${sw ? 'kuanzia' : 'from'} ${body}`;
  return body;
}

function priceLine(label, value, lang, seed) {
  if (lang === 'sw') {
    return pick(seed, [
      `${label} ni ${value}.`,
      `${label} inagharimu ${value}.`,
      `Bei ya ${label} ni ${value}.`,
    ]);
  }
  return pick(seed, [
    `${label} is ${value}.`,
    `${label} costs ${value}.`,
    `The price for ${label} is ${value}.`,
  ]);
}

function significant(name) {
  const generic = new Set(['cleaning', 'clean', 'service', 'services', 'the', 'and', 'for', 'with', 'from', 'bedroom', 'internal']);
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !generic.has(w));
}

function scoreLabel(text, label) {
  const bag = new Set(significant(text));
  const words = significant(label);
  if (!words.length) return 0;
  let hits = 0;
  for (const w of words) if (bag.has(w)) hits += 1;
  return hits / words.length;
}

const LABEL_GENERIC = new Set([
  'the', 'and', 'for', 'with', 'from', 'your', 'our', 'how', 'much', 'is', 'what', 'price', 'bei', 'ya', 'ni',
  'cleaning', 'clean', 'service', 'services', 'internal',
]);
// NOT generic: 'deep', 'standard' and similar tier words are what tell sibling
// rows apart ("Deep clean, 2 bedroom" vs "Standard clean, 2 bedroom").
const EN_NUM_WORD = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
// Bare counting forms plus the noun-class forms callers actually say with a noun:
// "chumba kimoja", "vyumba viwili/vitatu", "watu wawili", "magari mawili".
const SW_NUM_WORD = {
  moja: '1', kimoja: '1', mmoja: '1', limoja: '1',
  mbili: '2', viwili: '2', wawili: '2', mawili: '2',
  tatu: '3', vitatu: '3', watatu: '3', matatu: '3',
  nne: '4', vinne: '4', wanne: '4', manne: '4',
  tano: '5', vitano: '5', watano: '5', matano: '5',
  sita: '6', saba: '7', nane: '8', tisa: '9',
};

function normalizeCatalogueText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens for catalogue name matching: keep numeric qualifiers and distinctive words. */
function catalogueMatchTokens(text) {
  const words = normalizeCatalogueText(text).split(/\s+/).filter(Boolean);
  const tokens = new Set();
  for (const w of words) {
    if (/^\d+$/.test(w)) {
      tokens.add(w);
      continue;
    }
    const en = EN_NUM_WORD[w];
    const sw = SW_NUM_WORD[w];
    if (en) {
      tokens.add(en);
      continue;
    }
    if (sw) {
      tokens.add(sw);
      continue;
    }
    if (w.length >= 2 && !LABEL_GENERIC.has(w)) tokens.add(w);
  }
  return tokens;
}

function numericTokens(tokens) {
  return new Set([...tokens].filter((t) => /^\d+$/.test(t)));
}

/**
 * True when the question names a different number than this row, or names another
 * row's word while missing one of this row's own words. A row the question names in
 * full is never contradicted ("mattress and sofa" still asks which one).
 */
function contradictsLabel(qTokens, lTokens, vocab) {
  const qNums = numericTokens(qTokens);
  const lNums = numericTokens(lTokens);
  if (qNums.size && lNums.size && ![...qNums].some((n) => lNums.has(n))) return true;
  if (!vocab) return false;
  const namedInFull = [...lTokens].every((t) => qTokens.has(t));
  if (namedInFull) return false;
  for (const t of qTokens) if (vocab.has(t) && !lTokens.has(t)) return true;
  return false;
}

function catalogueVocab(facts) {
  const vocab = new Set();
  for (const f of facts) for (const t of catalogueMatchTokens(f.label)) vocab.add(t);
  return vocab;
}

/**
 * Score how well a caller question names a catalogue row. Full normalized names
 * and bedroom/number qualifiers beat shared prefixes like "deep clean".
 *
 * A row is ruled out (0) when the question contradicts it:
 * - the question has a number and the row has a different one ("2 bedroom" never
 *   matches "1 bedroom");
 * - the question has a word that names another row but not this one ("standard"
 *   rules out "Deep clean, 2 bedroom").
 * `vocab` is the union of all rows' match tokens.
 */
function scoreCatalogueLabel(query, label, vocab = null) {
  const qNorm = normalizeCatalogueText(query);
  const lNorm = normalizeCatalogueText(label);
  if (!lNorm) return 0;
  if (qNorm === lNorm) return 2;
  const qTokens = catalogueMatchTokens(query);
  const lTokens = catalogueMatchTokens(label);
  if (!lTokens.size) return 0;
  if (contradictsLabel(qTokens, lTokens, vocab)) return 0;
  if (qNorm.includes(lNorm)) return 1.5;
  let hits = 0;
  for (const t of lTokens) if (qTokens.has(t)) hits += 1;
  return hits / lTokens.size;
}

/** Below this a row is not "named" by the question; the legacy scorer decides. */
const CATALOGUE_MATCH_MIN = 0.5;

function pickPriceFactByLabel(query, facts) {
  const vocab = catalogueVocab(facts);
  const scored = facts
    .map((f) => ({ f, score: scoreCatalogueLabel(query, f.label, vocab) }))
    .filter((row) => row.score >= CATALOGUE_MATCH_MIN)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { kind: 'none' };
  const top = scored[0].score;
  const winners = scored.filter((row) => row.score === top);
  if (winners.length === 1) return { kind: 'one', fact: winners[0].f };
  if (scored.length > winners.length && top - scored[winners.length].score >= 0.2) {
    return { kind: 'one', fact: winners[0].f };
  }
  return { kind: 'ambiguous', facts: winners.map((row) => row.f) };
}

function catalogueEntries(profile) {
  return [
    ...asArray(profile?.servicesCatalog).map((row, index) => ({ row, index, kind: 'service' })),
    ...asArray(profile?.productCatalog).map((row, index) => ({ row, index, kind: 'product' })),
  ].filter((entry) => String(entry.row?.name || '').trim());
}

function locateRow(profile, label) {
  const want = String(label || '').trim().toLowerCase();
  return catalogueEntries(profile).find((entry) => String(entry.row.name).trim().toLowerCase() === want) || null;
}

function rowPath(entry) {
  if (!entry) return '';
  return entry.kind === 'product'
    ? productFieldPath(entry.row, entry.index)
    : serviceFieldPath(entry.index, entry.row);
}

function priceConfirmed(profile, entry, row) {
  return priceReading(profile, entry, row).ok;
}

function priceReading(profile, entry, row) {
  const value = entry ? catalogRowFactValue(entry.row) : row;
  return confirmReading(profile, rowPath(entry), value, entry ? entry.row : row);
}

function lookupPrice(query, ctx, sheet) {
  const profile = ctx.profile || {};
  const facts = [...sheet.facts.values()].filter((f) => f.kind === 'price');
  const q = String(query || '');
  const byLabel = pickPriceFactByLabel(q, facts);
  let fact = null;
  if (byLabel.kind === 'one') {
    fact = byLabel.fact;
  } else if (byLabel.kind === 'ambiguous') {
    const names = byLabel.facts.slice(0, 3).map((f) => f.label);
    const en = names.length === 2
      ? `Which one, ${names[0]} or ${names[1]}?`
      : `Which one, ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}?`;
    const sw = names.length === 2
      ? `Ipi, ${names[0]} au ${names[1]}?`
      : `Ipi, ${names.slice(0, -1).join(', ')} au ${names[names.length - 1]}?`;
    return resultOf('ambiguous', {
      id: 'price',
      options: names,
      speech: both(en, sw),
    }, profile, 'price');
  } else {
    // Legacy word overlap, minus rows the question contradicts, so "Standard
    // clean, 3 bedroom" cannot quote "Standard clean, 2 bedroom".
    const vocab = catalogueVocab(facts);
    const qTokens = catalogueMatchTokens(q);
    const scored = facts
      .filter((f) => !contradictsLabel(qTokens, catalogueMatchTokens(f.label), vocab))
      .map((f) => ({ f, score: scoreLabel(q, f.label) }))
      .filter((row) => row.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) {
      return catalogueEntries(profile).length || facts.length
        ? notFoundInList(profile, 'price', priceOptOut(profile, q), 'price')
        : noData(profile, 'price', 'price');
    }
    const top = scored.filter((row) => row.score === scored[0].score);
    if (top.length > 1) {
      const names = top.slice(0, 3).map((row) => row.f.label);
      const en = names.length === 2
        ? `Which one, ${names[0]} or ${names[1]}?`
        : `Which one, ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}?`;
      const sw = names.length === 2
        ? `Ipi, ${names[0]} au ${names[1]}?`
        : `Ipi, ${names.slice(0, -1).join(', ')} au ${names[names.length - 1]}?`;
      return resultOf('ambiguous', {
        id: 'price',
        options: names,
        speech: both(en, sw),
      }, profile, 'price');
    }
    fact = top[0].f;
  }
  if (!fact) {
    return catalogueEntries(profile).length || facts.length
      ? notFoundInList(profile, 'price', priceOptOut(profile, q), 'price')
      : noData(profile, 'price', 'price');
  }
  const entry = locateRow(profile, fact.label);
  const row = entry?.row || { name: fact.label, price: fact.legacyPrice || fact.value };
  const norm = normalisePrice(row);
  // quote, unknown, and a non-numeric price such as "Ask" are never spoken.
  if (!priceIsSpeakable(norm)) return notOnFile(profile, fact.id, `price_${norm.kind || 'unknown'}`, 'price');
  const reading = priceReading(profile, entry, row);
  if (!reading.ok) return unconfirmed(profile, fact.id, 'catalogue', reading.reason, 'price');
  const enVal = speakNormalisedPrice(norm, 'en');
  const swVal = speakNormalisedPrice(norm, 'sw');
  if (!enVal || !swVal) return notOnFile(profile, fact.id, 'price_unspoken', 'price');
  const seed = ctx.seed;
  return resultOf('found', {
    id: fact.id,
    value: norm.kind === 'range' ? norm.min : norm.min,
    source: 'owner',
    speech: both(priceLine(fact.label, enVal, 'en', seed), priceLine(fact.label, swVal, 'sw', seed)),
  }, profile, 'price');
}

function priceOptOut(profile, query) {
  if (!optedOutOfUnlisted(profile, 'price')) return null;
  const words = significant(query);
  if (!words.length) return null;
  const name = words.join(' ');
  return both(`We don't offer ${name}.`, `Hatutoi ${name}.`);
}

const FOLLOW_FILL = new Set([
  'and', 'na', 'je', 'the', 'a', 'an', 'ya', 'ni', 'so', 'uh', 'um', 'please', 'tafadhali',
  'for', 'about', 'it', 'that', 'this', 'one', 'also', 'pia', 'tu', 'basi', 'eh', 'ah',
  'cleaning', 'clean', 'service', 'services', 'how', 'much', 'is', 'bei', 'pesa', 'ngapi',
  'kiasi', 'what', 'of', 'do', 'you', 'your',
]);

/** A short follow-up that names a catalogue row, including a partial like "sofa". */
function matchCatalogueFollowUp(text, profile) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.length > 6) return '';
  const content = words.filter((w) => w.length >= 3 && !FOLLOW_FILL.has(w));
  if (!content.length || content.length > 3) return '';
  const names = catalogueEntries(profile).map((entry) => String(entry.row.name).trim());
  const query = content.join(' ');
  const scored = names
    .map((name) => ({ name, score: Math.max(scoreLabel(query, name), scoreCatalogueLabel(query, name)) }))
    .filter((row) => row.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (scored.length) {
    if (scored.length > 1 && scored[0].score === scored[1].score) return query;
    return scored[0].name;
  }
  const partial = names.filter((name) => {
    const sig = significant(name);
    return content.some((w) => sig.includes(w));
  });
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) return query;
  return '';
}

function feeNoun(kind, sw) {
  if (kind === 'delivery') return sw ? 'ada ya delivery' : 'delivery fee';
  return sw ? 'ada ya usafiri' : 'travel fee';
}

function areaSpeech(area, profile, seed) {
  const kind = area.kind === 'delivery' ? 'delivery' : 'travel';
  const name = area.name;
  if (area.feeMode === 'free') {
    return both(
      `There is no ${feeNoun(kind, false)} to ${name}.`,
      `Hakuna ${feeNoun(kind, true)} hadi ${name}.`,
    );
  }
  const enVal = speakMoney(area.feeKsh, 'en');
  const swVal = speakMoney(area.feeKsh, 'sw');
  const en = pick(seed, [
    `The ${feeNoun(kind, false)} to ${name} is ${enVal}.`,
    `${name} has a ${feeNoun(kind, false)} of ${enVal}.`,
  ]);
  const sw = pick(seed, [
    `${feeNoun(kind, true).charAt(0).toUpperCase()}${feeNoun(kind, true).slice(1)} hadi ${name} ni ${swVal}.`,
    `Hadi ${name}, ${feeNoun(kind, true)} ni ${swVal}.`,
  ]);
  return both(en, sw);
}

function clarifyPlace(amb) {
  const opts = (amb.options || []).slice(0, 2).map((o) => {
    const town = String(o.name || '').toLowerCase() === String(amb.heard || '').toLowerCase()
      ? `${o.name} town`
      : o.name;
    return { en: `${town} in ${o.county}`, sw: `${town} kule ${o.county}` };
  });
  if (opts.length < 2) return null;
  return both(
    `Do you mean ${opts[0].en}, or ${opts[1].en}?`,
    `Unamaanisha ${opts[0].sw}, au ${opts[1].sw}?`,
  );
}

function nluProfile(profile, terms) {
  const areas = (terms?.areas || []).map((a) => ({ id: a.id, name: a.name }));
  return { ...profile, serviceAreas: profile.serviceAreas || { areas }, areaTerms: terms, service_areas: profile.service_areas };
}

function dontCome(name) {
  return both(`We don't come to ${name}.`, `Hatufiki ${name}.`);
}

function rawArea(profile, id) {
  const bag = asObject(profile?.service_areas) || asObject(profile?.serviceAreas) || {};
  return asArray(bag.areas).find((area) => String(area?.id || '').trim().toLowerCase() === id) || null;
}

/** The fee row, minus the envelope, so a field-meta stamp can match it. */
function feeFactValue(area) {
  if (!area) return null;
  return {
    id: String(area.id || '').trim().toLowerCase(),
    fee_mode: area.fee_mode ?? null,
    fee_ksh: area.fee_ksh ?? null,
    modes: Array.isArray(area.modes) ? area.modes : null,
  };
}

function feeReading(profile, hit) {
  const raw = rawArea(profile, hit.id);
  return confirmReading(profile, `service_areas.${hit.id}`, feeFactValue(raw), raw || {});
}

function lookupFee(query, ctx, terms) {
  const profile = ctx.profile || {};
  const areas = terms?.areas || [];
  // No saved list. A known town is still missing data, not "we don't come".
  if (!areas.length) return noData(profile, 'fee', 'fee');
  const viewed = nluProfile(profile, terms);
  const amb = areaAmbiguity(String(query || ''), viewed);
  if (amb) {
    const speech = clarifyPlace(amb);
    if (speech) {
      return resultOf('ambiguous', {
        id: 'fee',
        options: amb.options,
        speech,
      }, profile, 'fee');
    }
  }
  const text = String(query || '');
  const hit = matchArea(text, terms) || (() => {
    const named = nluMatchArea(text, viewed);
    if (!named?.listed) return named ? { missing: named.name } : null;
    return matchArea(named.name, terms);
  })();
  if (hit && hit.missing) {
    const speech = optedOutOfUnlisted(profile, 'fee') ? dontCome(hit.missing) : null;
    return notFoundInList(profile, speech ? 'fee.out' : 'fee.missing', speech, 'fee');
  }
  if (!hit) return notFoundInList(profile, 'fee', null, 'fee');
  const feeRead = feeReading(profile, hit);
  if (!feeRead.ok) return unconfirmed(profile, `fee.${hit.id}`, 'area', feeRead.reason, 'fee');
  if (hit.feeMode !== 'free' && hit.feeKsh == null) {
    return unconfirmed(profile, `fee.${hit.id}`, 'area', 'fee_missing', 'fee');
  }
  return resultOf('found', {
    id: `fee.${hit.id}`,
    value: hit.feeMode === 'free' ? 0 : hit.feeKsh,
    source: 'owner',
    speech: areaSpeech(hit, profile, ctx.seed),
  }, profile, 'fee');
}

function parseClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

function enClock(hhmm) {
  const c = parseClock(hhmm);
  if (!c) return String(hhmm || '');
  const period = c.h >= 12 ? 'PM' : 'AM';
  const word = EN_HOUR[c.h % 12];
  if (!c.m) return `${word} ${period}`;
  if (c.m === 30) return `${word} thirty ${period}`;
  if (c.m === 15) return `${word} fifteen ${period}`;
  return `${word} ${numberToEn(c.m)} ${period}`;
}

function swClock(hhmm) {
  const c = parseClock(hhmm);
  if (!c) return String(hhmm || '');
  return speakSwClock(c.h, c.m);
}

function everyDaySame(parsed) {
  const first = parsed.days.mon;
  if (!first) return false;
  return DAY_ORDER.every((key) => {
    const day = parsed.days[key];
    return day && day.open === first.open && day.close === first.close;
  });
}

function weekRuns(parsed) {
  const runs = [];
  for (const key of DAY_ORDER) {
    const day = parsed.days[key];
    const open = day ? day.open : null;
    const close = day ? day.close : null;
    const last = runs[runs.length - 1];
    if (last && last.open === open && last.close === close) last.to = key;
    else runs.push({ from: key, to: key, open, close });
  }
  return runs;
}

function daySpan(run, sw) {
  const days = sw ? SW_DAY : EN_DAY;
  if (run.from === run.to) return days[run.from];
  return `${days[run.from]} ${sw ? 'hadi' : 'to'} ${days[run.to]}`;
}

function weekSpeech(parsed) {
  if (everyDaySame(parsed)) {
    const day = parsed.days.mon;
    return both(
      `We're open every day from ${enClock(day.open)} to ${enClock(day.close)}.`,
      `Tuko wazi kila siku kutoka ${swClock(day.open)} hadi ${swClock(day.close)}.`,
    );
  }
  const runs = weekRuns(parsed);
  const en = runs.map((run) => (
    run.open
      ? `${daySpan(run, false)}, ${enClock(run.open)} to ${enClock(run.close)}`
      : `closed ${daySpan(run, false)}`
  )).join('; ');
  const sw = runs.map((run) => (
    run.open
      ? `${daySpan(run, true)}, ${swClock(run.open)} hadi ${swClock(run.close)}`
      : `${daySpan(run, true)} tumefunga`
  )).join('; ');
  return both(`We're open ${en}.`, `Tuko wazi ${sw}.`);
}

// leo / kesho / today / tomorrow, read on the Nairobi date (eatParts). At
// 02:25 EAT on a Monday "kesho" is Tuesday; the answer names the day so the
// caller can correct it.
const RELATIVE_DAY = [
  { offset: 2, re: /\b(kesho kutwa|day after tomorrow)\b/i, en: 'The day after tomorrow', sw: 'Kesho kutwa' },
  { offset: 1, re: /\b(kesho|tomorrow)\b/i, en: 'Tomorrow', sw: 'Kesho' },
  { offset: 0, re: /\b(leo|today|tonight|this (?:morning|afternoon|evening))\b/i, en: 'Today', sw: 'Leo' },
];

function relativeDayAsked(query, now) {
  const text = typeof query === 'string' ? query : '';
  for (const rel of RELATIVE_DAY) {
    if (!rel.re.test(text)) continue;
    const today = eatParts(now).weekday;
    const key = DAY_ORDER[(DAY_ORDER.indexOf(today) + rel.offset) % 7];
    return { key, en: rel.en, sw: rel.sw };
  }
  return null;
}

function dayAsked(query) {
  const text = String(query || '');
  for (const [key, re] of Object.entries(DAY_WORD)) {
    if (re.test(text)) return key;
  }
  return '';
}

function hoursScope(query) {
  if (query && typeof query === 'object') return String(query.scope || 'week');
  const text = String(query || '');
  // "Na kesho, saa ngapi?" asks for that day's hours, not the clock.
  const namesDay = RELATIVE_DAY.some((rel) => rel.re.test(text)) && !/\b(today|leo)\b/i.test(text);
  if (/\b(what time is it|what(?:'s| is) the time|time now|saa ngapi)\b/i.test(text) && !/\b(mnafungua|mnafunga|open|close|hours|kazi)\b/i.test(text) && !namesDay && !dayAsked(text)) {
    return 'clock';
  }
  if (RELATIVE_DAY.some((rel) => rel.re.test(text))) return 'day';
  if (/\b(are you open|open now|mko wazi|uko wazi|are you closed)\b/i.test(text)) return 'open';
  if (dayAsked(text)) return 'day';
  return 'week';
}

function lookupHours(query, ctx) {
  const profile = ctx.profile || {};
  const scope = hoursScope(query);
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  if (scope === 'clock') {
    const p = eatParts(now);
    const hhmm = `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
    return resultOf('found', {
      id: 'hours.now',
      value: hhmm,
      source: 'clock',
      speech: both(`It is ${enClock(hhmm)}.`, `Sasa ni ${swClock(hhmm)}.`),
    }, profile, 'hours');
  }
  const parsed = parseHoursSchedule(profile.hoursSchedule);
  if (!parsed) return noData(profile, 'hours', 'hours');
  const tenant = tenantRowFromProfile(profile);
  const hoursRead = confirmReading(profile, 'hours.weekly_grid', factValueForPath('hours.weekly_grid', tenant), {});
  if (!hoursRead.ok) return unconfirmed(profile, 'hours', 'hours', hoursRead.reason, 'hours');
  if (scope === 'open') {
    const status = openClosedStatus(parsed, now);
    if (status === 'unknown') return notOnFile(profile, 'hours', 'open_status_unknown', 'hours');
    const open = status === 'open';
    return resultOf('found', {
      id: 'hours.open',
      value: status,
      source: 'owner',
      speech: both(
        open ? 'Yes, we are open now.' : 'No, we are closed now.',
        open ? 'Ndiyo, tuko wazi sasa.' : 'Hapana, tumefunga sasa.',
      ),
    }, profile, 'hours');
  }
  if (scope === 'day') {
    const rel = typeof query === 'string' ? relativeDayAsked(query, now) : null;
    const key = (query && query.day) || (rel && rel.key) || dayAsked(query) || eatParts(now).weekday;
    const day = parsed.days[key];
    // Always name the day. A relative ask leads with the word the caller used.
    const enLead = rel ? `${rel.en}, ${EN_DAY[key]},` : `On ${EN_DAY[key]}`;
    const swLead = rel ? `${rel.sw}, ${SW_DAY[key]},` : `Siku ya ${SW_DAY[key]}`;
    if (!day) {
      return resultOf('found', {
        id: `hours.${key}`,
        value: 'closed',
        source: 'owner',
        speech: both(`${enLead} we are closed.`, `${swLead} tumefunga.`),
      }, profile, 'hours');
    }
    return resultOf('found', {
      id: `hours.${key}`,
      value: `${day.open}-${day.close}`,
      source: 'owner',
      speech: both(
        `${enLead} we are open from ${enClock(day.open)} to ${enClock(day.close)}.`,
        `${swLead} tunafungua kutoka ${swClock(day.open)} hadi ${swClock(day.close)}.`,
      ),
    }, profile, 'hours');
  }
  return resultOf('found', {
    id: 'hours.week',
    value: 'week',
    source: 'owner',
    speech: weekSpeech(parsed),
  }, profile, 'hours');
}

function payBag(profile) {
  return asObject(asObject(profile.businessPolicies)?.payments) || {};
}

function payReading(profile, pay) {
  const tenant = tenantRowFromProfile(profile);
  const value = factValueForPath('payments.methods', tenant);
  const bag = pay && typeof pay === 'object' ? pay : {};
  return confirmReading(profile, 'payments.methods', value, bag);
}

const PAY_SLOT_LABEL = {
  till: { en: 'M-Pesa till number', sw: 'till ya M-Pesa' },
  paybill: { en: 'M-Pesa paybill number', sw: 'namba ya paybill ya M-Pesa' },
  pochi: { en: 'Pochi la Biashara number', sw: 'namba ya Pochi la Biashara' },
  send: { en: 'M-Pesa send money number', sw: 'namba ya kutuma pesa kwa M-Pesa' },
  airtel: { en: 'Airtel Money number', sw: 'namba ya Airtel Money' },
};

function paySlots(pay) {
  const paybill = asObject(pay.mpesa_paybill);
  return [
    ['till', digitsOf(pay.mpesa_till), PAY_SLOT_LABEL.till, null],
    ['paybill', digitsOf(paybill?.business_no), PAY_SLOT_LABEL.paybill, paybill],
    ['pochi', digitsOf(asObject(pay.pochi)?.phone), PAY_SLOT_LABEL.pochi, null],
    ['send', digitsOf(asObject(pay.mpesa_send)?.phone), PAY_SLOT_LABEL.send, null],
    ['airtel', digitsOf(asObject(pay.airtel)?.till || asObject(pay.airtel)?.phone), PAY_SLOT_LABEL.airtel, null],
  ].filter((row) => row[1]);
}

function payMethodIds(pay) {
  return asArray(pay?.methods).map((m) => String(m));
}

const MPESA_METHOD_IDS = new Set(['mpesa_till', 'mpesa_paybill', 'pochi', 'mpesa_send', 'airtel']);

function payNothingSaved(pay) {
  return payMethodIds(pay).length === 0;
}

function joinOrWords(words, lang) {
  if (!words.length) return '';
  if (words.length === 1) return words[0];
  const sep = lang === 'sw' ? ' au ' : ' or ';
  return `${words.slice(0, -1).join(', ')}${sep}${words[words.length - 1]}`;
}

function spokenPayMethodLine(pay, methodId) {
  switch (methodId) {
    case 'cash':
      return { en: 'cash', sw: 'pesa taslimu' };
    case 'cheque':
      return { en: 'cheque', sw: 'hundi' };
    case 'mpesa_till': {
      const till = digitsOf(pay.mpesa_till);
      return till
        ? { en: `M-Pesa Buy Goods Till ${till}`, sw: `M-Pesa Till ${till}` }
        : { en: 'M-Pesa Buy Goods', sw: 'M-Pesa Buy Goods' };
    }
    case 'mpesa_paybill': {
      const pb = asObject(pay.mpesa_paybill);
      const no = digitsOf(pb?.business_no);
      return no
        ? { en: `M-Pesa Paybill ${no}`, sw: `M-Pesa Paybill ${no}` }
        : { en: 'M-Pesa Paybill', sw: 'M-Pesa Paybill' };
    }
    case 'pochi': {
      const phone = digitsOf(asObject(pay.pochi)?.phone);
      return phone
        ? { en: 'Pochi la Biashara', sw: 'Pochi la Biashara' }
        : { en: 'Pochi la Biashara', sw: 'Pochi la Biashara' };
    }
    case 'mpesa_send':
      return { en: 'M-Pesa Send Money', sw: 'M-Pesa Send Money' };
    case 'airtel':
      return { en: 'Airtel Money', sw: 'Airtel Money' };
    case 'bank':
      return { en: 'bank transfer', sw: 'uhamisho wa benki' };
    case 'card':
      return { en: 'card', sw: 'kadi' };
    default:
      return null;
  }
}

function payMethodLines(pay, filterKind) {
  const methods = payMethodIds(pay);
  const lines = [];
  for (const id of methods) {
    if (filterKind === 'cash' && id !== 'cash') continue;
    if (filterKind === 'cheque' && id !== 'cheque') continue;
    if (filterKind === 'mpesa' && !MPESA_METHOD_IDS.has(id)) continue;
    if (filterKind === 'bank' && id !== 'bank') continue;
    if (filterKind === 'card' && id !== 'card') continue;
    const line = spokenPayMethodLine(pay, id);
    if (line) lines.push(line);
  }
  return lines;
}

function payMethodOffered(pay, kind) {
  const methods = payMethodIds(pay);
  if (kind === 'cash') return methods.includes('cash');
  if (kind === 'cheque') return methods.includes('cheque');
  if (kind === 'mpesa') return methods.some((m) => MPESA_METHOD_IDS.has(m));
  if (kind === 'bank') return methods.includes('bank');
  if (kind === 'card') return methods.includes('card');
  return false;
}

function payMethodListSpeech(pay, { only } = {}) {
  const lines = payMethodLines(pay, only || null);
  if (!lines.length) return null;
  const enParts = lines.map((l) => l.en);
  const swParts = lines.map((l) => l.sw);
  return {
    en: `You can pay by ${joinOrWords(enParts, 'en')}.`,
    sw: `Unaweza kulipa kwa ${joinOrWords(swParts, 'sw')}.`,
    value: enParts.join(', '),
  };
}

function payGeneralQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return (
    /\b(how do i pay|how can i pay|how to pay|payment methods?|ways to pay|what do you accept)\b/i.test(t)
    || /\b(nalipaje|namna ya kulipa|jinsi ya kulipa|malipo)\b/i.test(t)
  );
}

function payMethodCashQuestion(text) {
  const t = String(text || '');
  return (
    /\b(pesa taslimu|fedha taslimu)\b/i.test(t)
    || (/\bcash\b/i.test(t) && /\b(pay|accept|take|can i|do you)\b/i.test(t))
  );
}

function payMethodChequeQuestion(text) {
  const t = String(text || '');
  return (
    /\b(hundi|cheki)\b/i.test(t)
    || (/\bcheque?s?\b/i.test(t) && /\b(pay|accept|take|can i|do you)\b/i.test(t))
  );
}

function payMethodMpesaQuestion(text) {
  const t = String(text || '');
  return (
    /\b(m-?pesa|mpesa)\b/i.test(t)
    || /\b(lipa na m-?pesa|lipa kwa m-?pesa)\b/i.test(t)
    || /\b(mnachukua|mnapokea|mnalipa)\b.*\b(m-?pesa|mpesa)\b/i.test(t)
    || (/\b(do you take|do you accept|can i pay with)\b/i.test(t) && /\b(m-?pesa|mpesa)\b/i.test(t))
  );
}

function payMethodBankQuestion(text) {
  return /\b(bank transfer|bank account|pay by bank)\b/i.test(String(text || ''))
    && !/\baccount number\b/i.test(String(text || ''));
}

function payMethodCardQuestion(text) {
  return /\b(pay by card|accept card|visa|mastercard|card payment)\b/i.test(String(text || ''))
    && !/\bcard number\b/i.test(String(text || ''));
}

function payQuestionIntent(query) {
  const text = String(query || '');
  const numberKind = payKindOf(query);
  if (numberKind !== 'any') return { mode: 'number', kind: numberKind };
  if (payMethodChequeQuestion(text)) return { mode: 'method', method: 'cheque' };
  if (payMethodCashQuestion(text)) return { mode: 'method', method: 'cash' };
  if (payMethodMpesaQuestion(text)) return { mode: 'method', method: 'mpesa' };
  if (payMethodBankQuestion(text)) return { mode: 'method', method: 'bank' };
  if (payMethodCardQuestion(text)) return { mode: 'method', method: 'card' };
  if (payGeneralQuestion(text)) return { mode: 'general' };
  return { mode: 'general' };
}

function payKindOf(query) {
  if (query && typeof query === 'object' && query.kind) return String(query.kind);
  const text = String(query || '');
  if (/pay\s?bill|paybill|business number/i.test(text)) return 'paybill';
  if (/pochi/i.test(text)) return 'pochi';
  if (/airtel/i.test(text)) return 'airtel';
  if (/\b(bank|account number)\b/i.test(text)) return 'bank';
  if (/\bcard\b/i.test(text)) return 'card';
  if (/till|lipa na|namba ya malipo|namba ya till/i.test(text)) return 'till';
  return 'any';
}

function digitsOf(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function speakDigits(raw, lang) {
  const digits = digitsOf(raw);
  if (!digits) return '';
  const words = lang === 'sw' ? SW_DIGIT : EN_DIGIT;
  return [...digits].map((d) => words[Number(d)]).join(' ');
}

function lookupPayNumber(kind, profile, pay) {
  if (kind === 'bank' || kind === 'card') {
    return notFoundInList(profile, `pay.${kind}`, null, 'pay');
  }
  const slots = paySlots(pay);
  if (!slots.length) {
    return noData(profile, `pay.${kind}`, 'pay');
  }
  const want = {
    till: 'till',
    paybill: 'paybill',
    pochi: 'pochi',
    airtel: 'airtel',
    any: '',
  }[kind];
  const slot = want ? slots.find((row) => row[0] === want) : slots[0];
  if (!slot) return notFoundInList(profile, `pay.${kind}`, null, 'pay');
  const payRead = payReading(profile, pay);
  if (!payRead.ok) return unconfirmed(profile, `pay.${slot[0]}`, 'pay', payRead.reason, 'pay');
  const enDigits = speakDigits(slot[1], 'en');
  const swDigits = speakDigits(slot[1], 'sw');
  const labels = slot[2];
  let en = `The ${labels.en} is ${enDigits}.`;
  let sw = `Namba ya ${labels.sw} ni ${swDigits}.`;
  const account = slot[3] && (slot[3].account_mode || 'fixed') === 'fixed' ? digitsOf(slot[3].account) : '';
  if (account) {
    en += ` The account is ${speakDigits(account, 'en')}.`;
    sw += ` Akaunti ni ${speakDigits(account, 'sw')}.`;
  }
  return resultOf('found', {
    id: `pay.${slot[0] === 'till' ? 'mpesa_till' : slot[0] === 'paybill' ? 'mpesa_paybill' : slot[0] === 'send' ? 'mpesa_send' : slot[0]}`,
    value: slot[1],
    source: 'owner',
    speech: both(en, sw),
  }, profile, 'pay');
}

function lookupPayMethods(profile, pay, intent) {
  const payRead = payReading(profile, pay);
  if (intent.mode === 'method' && !payMethodOffered(pay, intent.method)) {
    return notFoundInList(profile, `pay.${intent.method}`, null, 'pay');
  }
  if (!payRead.ok) return unconfirmed(profile, 'payments.methods', 'pay', payRead.reason, 'pay');
  const speech = intent.mode === 'method'
    ? payMethodListSpeech(pay, { only: intent.method })
    : payMethodListSpeech(pay);
  if (!speech) return noData(profile, 'pay', 'pay');
  return resultOf('found', {
    id: intent.mode === 'method' ? `pay.${intent.method}` : 'pay.methods',
    value: speech.value,
    source: 'owner',
    speech: both(speech.en, speech.sw),
  }, profile, 'pay');
}

function lookupPay(query, ctx) {
  const profile = ctx.profile || {};
  const pay = payBag(profile);
  if (payNothingSaved(pay)) {
    return noData(profile, 'pay', 'pay');
  }
  const intent = payQuestionIntent(query);
  if (intent.mode === 'number') {
    return lookupPayNumber(intent.kind, profile, pay);
  }
  return lookupPayMethods(profile, pay, intent);
}

function speechName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function lookupServices(ctx) {
  const profile = ctx.profile || {};
  const rows = catalogueEntries(profile);
  if (!rows.length) return noData(profile, 'services', 'price');
  const confirmed = rows.filter((entry) => priceConfirmed(profile, entry, entry.row));
  if (!confirmed.length) {
    return unconfirmed(profile, 'services', 'catalogue', priceReading(profile, rows[0], rows[0].row).reason, 'price');
  }
  const names = confirmed.map((entry) => speechName(entry.row.name));
  const more = names.length > 4;
  const shown = names.slice(0, 4);
  const enList = joinAnd(shown.concat(more ? ['more'] : []), 'and');
  const swList = joinAnd(shown.concat(more ? ['zingine'] : []), 'na');
  const seed = ctx.seed;
  const en = pick(seed, [`We do ${enList}.`, `Our services are ${enList}.`, `We offer ${enList}.`]);
  const sw = pick(seed, [`Tunafanya ${swList}.`, `Huduma zetu ni ${swList}.`, `Tunatoa ${swList}.`]);
  return resultOf('found', {
    id: 'services',
    value: shown,
    source: 'owner',
    speech: both(en, sw),
  }, profile, 'price');
}

/**
 * @param {'price'|'area_fee'|'fee'|'hours'|'pay'|'services'} kind
 * @param {string|object} query
 * @param {{ profile?: object, language?: string, now?: Date, seed?: number }} [ctx]
 */
function lookup(kind, query, ctx = {}) {
  const profile = ctx.profile || {};
  const key = String(kind || '').toLowerCase();
  const canonical = key === 'area_fee' || key === 'coverage' || key === 'area' ? 'fee' : key;
  // tenant_hold_gate (profile.holdGate) is the stock-reservation capability.
  // It never decides whether a confirmed fact may be spoken.
  const terms = termsFor(profile);
  const sheet = sheetFor(profile, terms);
  if (canonical === 'price') return lookupPrice(query, ctx, sheet);
  if (canonical === 'fee') return lookupFee(query, ctx, terms);
  if (canonical === 'hours') return lookupHours(query, ctx);
  if (canonical === 'pay') return lookupPay(query, ctx);
  if (canonical === 'services') return lookupServices(ctx);
  return notOnFile(profile, canonical || 'unknown', 'unknown_kind', canonical || 'general');
}

function cataloguePhrases(profile) {
  return [...asArray(profile?.servicesCatalog), ...asArray(profile?.productCatalog)]
    .map((row) => String(row?.name || '').trim())
    .filter(Boolean);
}

/**
 * Speak a lookup, or the cannot-answer line if it is not back within timeoutMs.
 * An ack is set only when the deadline wins, so a fast lookup is spoken as-is.
 */
function lookupWithDeadline(kind, query, ctx = {}, opts = {}) {
  const ms = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 1500;
  const fn = opts.lookupFn || lookup;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const run = Promise.resolve()
    .then(() => fn(kind, query, ctx))
    .then((result) => ({ timedOut: false, result }));
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer)).then((out) => {
    if (out.timedOut || !out.result) {
      const fb = notOnFile(ctx.profile || {}, 'timeout', 'timeout', kind);
      const lang = ctx.language;
      return {
        timedOut: true,
        speech: speechOf(fb, lang),
        ack: swish(lang) ? 'Sawa.' : 'One moment.',
        result: fb,
      };
    }
    return { timedOut: false, speech: speechOf(out.result, ctx.language), ack: '', result: out.result };
  });
}

function lookupToolDeclaration() {
  return {
    functionDeclarations: [
      {
        name: 'lookup',
        description:
          'Look up a confirmed price, travel fee, opening hours, payment number, or the services list for this turn only. Do not speak a number yourself.',
        parameters: {
          type: 'OBJECT',
          properties: {
            kind: { type: 'STRING', enum: ['price', 'fee', 'hours', 'pay', 'services'] },
            query: { type: 'STRING', description: 'The caller question, this turn only.' },
          },
          required: ['kind', 'query'],
        },
      },
    ],
  };
}

module.exports = {
  lookup,
  speechOf,
  lookupWithDeadline,
  cataloguePhrases,
  lookupToolDeclaration,
  matchCatalogueFollowUp,
  factIsConfirmed,
};
