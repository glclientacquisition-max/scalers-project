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

function fallbackSpeech(profile) {
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

function resultOf(status, extra, profile) {
  const speech = extra.speech || fallbackSpeech(profile);
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

function notOnFile(profile, id, reason) {
  return resultOf('not_on_file', { id, reason, speech: fallbackSpeech(profile) }, profile);
}

/** The list itself was never saved. Never speak that as "we don't do this". */
function noData(profile, id) {
  return resultOf('no_data', { id, speech: fallbackSpeech(profile) }, profile);
}

/**
 * The list exists and this item is not on it. The callback line, unless the
 * business explicitly opted out of anything off the list.
 */
function notFoundInList(profile, id, optOutSpeech) {
  const speech = optOutSpeech || fallbackSpeech(profile);
  return resultOf('not_found_in_list', { id, speech }, profile);
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

function unconfirmed(profile, id, source, reason) {
  return resultOf('unconfirmed', { id, source, reason, speech: fallbackSpeech(profile) }, profile);
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
  const scored = facts
    .map((f) => ({ f, score: scoreLabel(query, f.label) }))
    .filter((row) => row.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return catalogueEntries(profile).length || facts.length
      ? notFoundInList(profile, 'price', priceOptOut(profile, query))
      : noData(profile, 'price');
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
    }, profile);
  }
  const fact = top[0].f;
  const entry = locateRow(profile, fact.label);
  const row = entry?.row || { name: fact.label, price: fact.legacyPrice || fact.value };
  const norm = normalisePrice(row);
  // quote, unknown, and a non-numeric price such as "Ask" are never spoken.
  if (!priceIsSpeakable(norm)) return notOnFile(profile, fact.id, `price_${norm.kind || 'unknown'}`);
  const reading = priceReading(profile, entry, row);
  if (!reading.ok) return unconfirmed(profile, fact.id, 'catalogue', reading.reason);
  const enVal = speakNormalisedPrice(norm, 'en');
  const swVal = speakNormalisedPrice(norm, 'sw');
  if (!enVal || !swVal) return notOnFile(profile, fact.id, 'price_unspoken');
  const seed = ctx.seed;
  return resultOf('found', {
    id: fact.id,
    value: norm.kind === 'range' ? norm.min : norm.min,
    source: 'owner',
    speech: both(priceLine(fact.label, enVal, 'en', seed), priceLine(fact.label, swVal, 'sw', seed)),
  }, profile);
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
    .map((name) => ({ name, score: scoreLabel(query, name) }))
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
  if (!areas.length) return noData(profile, 'fee');
  const viewed = nluProfile(profile, terms);
  const amb = areaAmbiguity(String(query || ''), viewed);
  if (amb) {
    const speech = clarifyPlace(amb);
    if (speech) {
      return resultOf('ambiguous', {
        id: 'fee',
        options: amb.options,
        speech,
      }, profile);
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
    return notFoundInList(profile, speech ? 'fee.out' : 'fee.missing', speech);
  }
  if (!hit) return notFoundInList(profile, 'fee');
  const feeRead = feeReading(profile, hit);
  if (!feeRead.ok) return unconfirmed(profile, `fee.${hit.id}`, 'area', feeRead.reason);
  if (hit.feeMode !== 'free' && hit.feeKsh == null) {
    return unconfirmed(profile, `fee.${hit.id}`, 'area', 'fee_missing');
  }
  return resultOf('found', {
    id: `fee.${hit.id}`,
    value: hit.feeMode === 'free' ? 0 : hit.feeKsh,
    source: 'owner',
    speech: areaSpeech(hit, profile, ctx.seed),
  }, profile);
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
  if (/\b(what time is it|what(?:'s| is) the time|time now|saa ngapi)\b/i.test(text) && !/\b(mnafungua|mnafunga|open|close|hours|kazi)\b/i.test(text)) {
    return 'clock';
  }
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
    }, profile);
  }
  const parsed = parseHoursSchedule(profile.hoursSchedule);
  if (!parsed) return noData(profile, 'hours');
  const tenant = tenantRowFromProfile(profile);
  const hoursRead = confirmReading(profile, 'hours.weekly_grid', factValueForPath('hours.weekly_grid', tenant), {});
  if (!hoursRead.ok) return unconfirmed(profile, 'hours', 'hours', hoursRead.reason);
  if (scope === 'open') {
    const status = openClosedStatus(parsed, now);
    if (status === 'unknown') return notOnFile(profile, 'hours', 'open_status_unknown');
    const open = status === 'open';
    return resultOf('found', {
      id: 'hours.open',
      value: status,
      source: 'owner',
      speech: both(
        open ? 'Yes, we are open now.' : 'No, we are closed now.',
        open ? 'Ndiyo, tuko wazi sasa.' : 'Hapana, tumefunga sasa.',
      ),
    }, profile);
  }
  if (scope === 'day') {
    const key = (query && query.day) || dayAsked(query) || eatParts(now).weekday;
    const day = parsed.days[key];
    if (!day) {
      return resultOf('found', {
        id: `hours.${key}`,
        value: 'closed',
        source: 'owner',
        speech: both(`On ${EN_DAY[key]} we are closed.`, `Siku ya ${SW_DAY[key]} tumefunga.`),
      }, profile);
    }
    return resultOf('found', {
      id: `hours.${key}`,
      value: `${day.open}-${day.close}`,
      source: 'owner',
      speech: both(
        `On ${EN_DAY[key]} we are open from ${enClock(day.open)} to ${enClock(day.close)}.`,
        `Siku ya ${SW_DAY[key]} tunafungua kutoka ${swClock(day.open)} hadi ${swClock(day.close)}.`,
      ),
    }, profile);
  }
  return resultOf('found', {
    id: 'hours.week',
    value: 'week',
    source: 'owner',
    speech: weekSpeech(parsed),
  }, profile);
}

function payBag(profile) {
  return asObject(asObject(profile.businessPolicies)?.payments) || {};
}

function payReading(profile, pay) {
  const tenant = tenantRowFromProfile(profile);
  return confirmReading(profile, 'payments.methods', factValueForPath('payments.methods', tenant), pay);
}

function paySlots(pay) {
  const paybill = asObject(pay.mpesa_paybill);
  return [
    ['till', digitsOf(pay.mpesa_till), 'M-Pesa till number', null],
    ['paybill', digitsOf(paybill?.business_no), 'M-Pesa paybill number', paybill],
    ['pochi', digitsOf(asObject(pay.pochi)?.phone), 'Pochi la Biashara number', null],
    ['send', digitsOf(asObject(pay.mpesa_send)?.phone), 'M-Pesa send money number', null],
    ['airtel', digitsOf(asObject(pay.airtel)?.till || asObject(pay.airtel)?.phone), 'Airtel Money number', null],
  ].filter((row) => row[1]);
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

function lookupPay(query, ctx) {
  const profile = ctx.profile || {};
  const kind = payKindOf(query);
  const pay = payBag(profile);
  const slots = paySlots(pay);
  if (!slots.length) return noData(profile, `pay.${kind}`);
  if (kind === 'bank' || kind === 'card') {
    return notFoundInList(profile, `pay.${kind}`);
  }
  const want = {
    till: 'till',
    paybill: 'paybill',
    pochi: 'pochi',
    airtel: 'airtel',
    any: '',
  }[kind];
  const slot = want ? slots.find((row) => row[0] === want) : slots[0];
  if (!slot) return notFoundInList(profile, `pay.${kind}`);
  const payRead = payReading(profile, pay);
  if (!payRead.ok) return unconfirmed(profile, `pay.${slot[0]}`, 'pay', payRead.reason);
  const enDigits = speakDigits(slot[1], 'en');
  const swDigits = speakDigits(slot[1], 'sw');
  let en = `The ${slot[2]} is ${enDigits}.`;
  let sw = `Namba ya ${slot[2]} ni ${swDigits}.`;
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
  }, profile);
}

function speechName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function lookupServices(ctx) {
  const profile = ctx.profile || {};
  const rows = catalogueEntries(profile);
  if (!rows.length) return noData(profile, 'services');
  const confirmed = rows.filter((entry) => priceConfirmed(profile, entry, entry.row));
  if (!confirmed.length) {
    return unconfirmed(profile, 'services', 'catalogue', priceReading(profile, rows[0], rows[0].row).reason);
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
  }, profile);
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
  return notOnFile(profile, canonical || 'unknown', 'unknown_kind');
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
      const fb = notOnFile(ctx.profile || {}, 'timeout', 'timeout');
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
