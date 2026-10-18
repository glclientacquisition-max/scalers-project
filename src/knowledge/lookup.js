'use strict';
// One fact lookup for prices, area fees, hours, payment numbers and the
// services list. Speech is pre-rendered in the caller's language (Sheng is
// Swahili). A missing or unconfirmed fact is the cannot-answer line, never a
// guess. Pure: no I/O. The caller passes the live tenant profile.

const { readAreaTerms, matchArea } = require('../conversation/areaTerms');
const { pickUnknownAnswerLine, callbackSafeLine, factSheetFor, TEAM_DEFAULT_LINE } = require('../conversation/factSheet');
const { normalisePrice, priceIsSpeakable } = require('../conversation/factPrice');
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

const CAT_RANK = { deep: 0, standard: 1, sofa: 2, carpet: 3 };
const CAT_LABEL = {
  deep: { en: 'deep cleaning', sw: 'usafi wa kina' },
  standard: { en: 'standard cleaning', sw: 'usafi wa kawaida' },
  sofa: { en: 'sofa cleaning', sw: 'usafi wa sofa' },
  carpet: { en: 'carpet cleaning', sw: 'usafi wa zulia' },
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
  };
}

function notOnFile(profile, id) {
  return resultOf('not_on_file', { id, speech: fallbackSpeech(profile) }, profile);
}

function unconfirmed(profile, id, source) {
  return resultOf('unconfirmed', { id, source, speech: fallbackSpeech(profile) }, profile);
}

function factsHeld(profile) {
  const gate = profile?.holdGate;
  if (!gate || typeof gate !== 'object' || typeof gate.allowed !== 'boolean') return false;
  const reasons = Array.isArray(gate.reasons) ? gate.reasons.map(String) : [];
  if (reasons.includes('provenance_rpc_missing')) return false;
  return gate.allowed === false;
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

function lookupPrice(query, ctx, sheet) {
  const profile = ctx.profile || {};
  const facts = [...sheet.facts.values()].filter((f) => f.kind === 'price');
  const scored = facts
    .map((f) => ({ f, score: scoreLabel(query, f.label) }))
    .filter((row) => row.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return notOnFile(profile, 'price');
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
  const row = catalogueRow(profile, fact.label) || { name: fact.label, price: fact.legacyPrice || fact.value };
  const norm = normalisePrice(row);
  // quote, unknown, and a non-numeric price such as "Ask" are never spoken.
  if (!priceIsSpeakable(norm)) return notOnFile(profile, fact.id);
  if (!fact.confirmed) return unconfirmed(profile, fact.id, 'catalogue');
  const enVal = speakNormalisedPrice(norm, 'en');
  const swVal = speakNormalisedPrice(norm, 'sw');
  if (!enVal || !swVal) return notOnFile(profile, fact.id);
  const seed = ctx.seed;
  return resultOf('found', {
    id: fact.id,
    value: norm.kind === 'range' ? norm.min : norm.min,
    source: 'owner',
    speech: both(priceLine(fact.label, enVal, 'en', seed), priceLine(fact.label, swVal, 'sw', seed)),
  }, profile);
}

function catalogueRow(profile, label) {
  const want = String(label || '').trim().toLowerCase();
  const rows = [...asArray(profile.servicesCatalog), ...asArray(profile.productCatalog)];
  return rows.find((row) => String(row?.name || '').trim().toLowerCase() === want) || null;
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

function lookupFee(query, ctx, terms) {
  const profile = ctx.profile || {};
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
    return resultOf('found', {
      id: 'fee.out',
      value: null,
      speech: both(`We don't come to ${hit.missing}.`, `Hatufiki ${hit.missing}.`),
    }, profile);
  }
  if (!hit) return notOnFile(profile, 'fee');
  if (!hit.trusted || (hit.feeMode !== 'free' && hit.feeKsh == null)) return unconfirmed(profile, `fee.${hit.id}`, 'area');
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

function weekSpeech(parsed) {
  if (everyDaySame(parsed)) {
    const day = parsed.days.mon;
    return both(
      `We're open every day from ${enClock(day.open)} to ${enClock(day.close)}.`,
      `Tuko wazi kila siku kutoka ${swClock(day.open)} hadi ${swClock(day.close)}.`,
    );
  }
  const en = [];
  const sw = [];
  for (const key of DAY_ORDER) {
    const day = parsed.days[key];
    if (!day) {
      en.push(`${EN_DAY[key]} closed`);
      sw.push(`${SW_DAY[key]} tumefunga`);
    } else {
      en.push(`${EN_DAY[key]} ${enClock(day.open)} to ${enClock(day.close)}`);
      sw.push(`${SW_DAY[key]} ${swClock(day.open)} hadi ${swClock(day.close)}`);
    }
  }
  return both(`We're open ${en.join(', ')}.`, `Tuko wazi ${sw.join(', ')}.`);
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
  if (profile.hoursConfirmed === false) return unconfirmed(profile, 'hours', 'hours');
  const parsed = parseHoursSchedule(profile.hoursSchedule);
  if (!parsed) return notOnFile(profile, 'hours');
  if (scope === 'open') {
    const status = openClosedStatus(parsed, now);
    if (status === 'unknown') return notOnFile(profile, 'hours');
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

function payOwnerConfirmed(profile) {
  const pay = payBag(profile);
  return pay.source === 'owner' && (pay.confirmed === true || pay.confirmed === 'true');
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

function lookupPay(query, ctx, sheet) {
  const profile = ctx.profile || {};
  const kind = payKindOf(query);
  if (kind === 'bank' || kind === 'card') return notOnFile(profile, `pay.${kind}`);
  const facts = [...sheet.facts.values()].filter((f) => f.kind === 'pay');
  const owner = payOwnerConfirmed(profile);
  const want = {
    till: ['pay.mpesa_till'],
    paybill: ['pay.mpesa_paybill'],
    pochi: ['pay.pochi'],
    airtel: ['pay.airtel_till', 'pay.airtel_phone'],
    any: ['pay.mpesa_till', 'pay.mpesa_paybill', 'pay.pochi', 'pay.mpesa_send'],
  }[kind] || [];
  const fact = facts.find((f) => want.includes(f.id) && digitsOf(f.value));
  if (!fact) return notOnFile(profile, `pay.${kind}`);
  if (!fact.confirmed && !owner) return unconfirmed(profile, fact.id, 'pay');
  const enDigits = speakDigits(fact.value, 'en');
  const swDigits = speakDigits(fact.value, 'sw');
  let en = `The ${fact.label} is ${enDigits}.`;
  let sw = `Namba ya ${fact.label} ni ${swDigits}.`;
  if (fact.account && digitsOf(fact.account)) {
    en += ` The account is ${speakDigits(fact.account, 'en')}.`;
    sw += ` Akaunti ni ${speakDigits(fact.account, 'sw')}.`;
  }
  return resultOf('found', {
    id: fact.id,
    value: digitsOf(fact.value),
    source: 'owner',
    speech: both(en, sw),
  }, profile);
}

function categoryOf(name) {
  const n = String(name || '').toLowerCase();
  if (/\bdeep\b/.test(n)) return 'deep';
  if (/\bstandard\b/.test(n)) return 'standard';
  if (/\bsofa\b|\bcouch\b/.test(n)) return 'sofa';
  if (/\bcarpet\b|\bzulia\b/.test(n)) return 'carpet';
  return '';
}

function lookupServices(ctx, sheet) {
  const profile = ctx.profile || {};
  const facts = [...sheet.facts.values()].filter((f) => f.kind === 'price' && f.confirmed);
  const seen = new Set();
  const cats = [];
  for (const fact of facts) {
    const key = categoryOf(fact.label) || fact.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const preset = CAT_LABEL[key];
    cats.push({
      key,
      en: preset ? preset.en : fact.label,
      sw: preset ? preset.sw : fact.label,
    });
  }
  cats.sort((a, b) => (CAT_RANK[a.key] ?? 9) - (CAT_RANK[b.key] ?? 9));
  if (!cats.length) return notOnFile(profile, 'services');
  const more = cats.length > 4;
  const shown = cats.slice(0, 4);
  const enList = joinAnd(shown.map((c) => c.en).concat(more ? ['more'] : []), 'and');
  const swList = joinAnd(shown.map((c) => c.sw).concat(more ? ['zingine'] : []), 'na');
  const seed = ctx.seed;
  const en = pick(seed, [`We do ${enList}.`, `Our services are ${enList}.`, `We offer ${enList}.`]);
  const sw = pick(seed, [`Tunafanya ${swList}.`, `Huduma zetu ni ${swList}.`, `Tunatoa ${swList}.`]);
  return resultOf('found', {
    id: 'services',
    value: shown.map((c) => c.key),
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
  if (factsHeld(profile)) return unconfirmed(profile, canonical || 'held', 'hold');
  const terms = termsFor(profile);
  const sheet = sheetFor(profile, terms);
  if (canonical === 'price') return lookupPrice(query, ctx, sheet);
  if (canonical === 'fee') return lookupFee(query, ctx, terms);
  if (canonical === 'hours') return lookupHours(query, ctx);
  if (canonical === 'pay') return lookupPay(query, ctx, sheet);
  if (canonical === 'services') return lookupServices(ctx, sheet);
  return notOnFile(profile, canonical || 'unknown');
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
      const fb = notOnFile(ctx.profile || {}, 'timeout');
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
};
