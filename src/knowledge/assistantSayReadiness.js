'use strict';

const { lookup, speechOf } = require('./lookup');
const { ownerLookupReason } = require('./lookupOwnerReason');
const { readAreaTerms } = require('../conversation/areaTerms');

const INTRO = '';

function greetingPreview(profile) {
  const owner = String(profile?.greetingText || '').trim();
  if (owner) return owner.length > 160 ? `${owner.slice(0, 157)}…` : owner;
  const spoken = String(profile?.spokenName || profile?.spoken_name || '').trim();
  const usesSpoken = Boolean(spoken) && !/^the business$/i.test(spoken);
  const name = usesSpoken
    ? spoken
    : String(profile?.businessName || profile?.business_name || '').trim();
  if (!name) return '';
  const inviteRaw = String(profile?.greetingInvite || profile?.greeting_invite || '').trim();
  const invite = inviteRaw || 'How can I help?';
  return `${name}. ${invite}`;
}

function greetingRow(profile) {
  const hearPreview = greetingPreview(profile);
  const willSay = Boolean(hearPreview);
  return {
    id: 'greeting',
    title: 'Greeting',
    isFact: false,
    willSay,
    stampTone: willSay ? 'ok' : 'attention',
    stampLabel: willSay ? 'Will say' : "Won't say",
    reason: willSay ? 'Ready on the next call.' : 'Add your business name on Identity.',
    fixHref: '/settings?tab=train&panel=identity',
    hearPreview,
  };
}

const FIX = {
  prices: '/settings/knowledge',
  hours: '/settings?tab=train&panel=hours',
  areas: '/settings/areas',
  payment: '/settings?tab=train&panel=policies',
  unsure: '/settings?tab=assistant-say&topic=unsure',
};

function ctx(profile, now) {
  return { profile, language: 'en', now: now || new Date(), seed: 0 };
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

/** The tenant's own catalogue names (services and products), as voice price lookups see them. */
function catalogNames(profile) {
  const rows = [
    ...asList(profile?.servicesCatalog || profile?.services_catalog),
    ...asList(profile?.productCatalog || profile?.product_catalog),
  ];
  return [...new Set(rows.map((row) => String(row?.name || '').trim()).filter(Boolean))];
}

/**
 * The tenant's own saved delivery/service area names, resolved exactly as voice
 * fee lookups resolve them (areaTerms), so an id-only row like
 * {id: 'place:westlands'} is asked about as "Westlands", not its id.
 */
function areaNames(profile) {
  const raw = profile?.service_areas || profile?.serviceAreas;
  const terms = profile?.areaTerms?.areas?.length
    ? profile.areaTerms
    : raw
      ? readAreaTerms(raw, { vertical: profile?.vertical, env: { VOICE_AREA_FEES: 'on' } })
      : null;
  const names = asList(terms?.areas).map((a) => String(a?.name || '').trim()).filter(Boolean);
  return [...new Set(names)];
}

/** Probe caps: enough to find one answer on a long catalogue without a slow page. */
const MAX_PROBES = 25;

/**
 * Questions the readiness rows (and the Desk preview defaults) ask voice lookups.
 * Prices and delivery come only from this tenant's catalogue and areas; hours and
 * payment are generic. A tenant with no catalogue or no areas gets no question:
 * the probe asks an empty query, which voice reports as missing data.
 */
function readinessQuestions(profile) {
  return {
    price: catalogNames(profile).slice(0, MAX_PROBES).map((name) => `How much is ${name}?`),
    hours: ['What are your opening hours?'],
    fee: areaNames(profile).slice(0, MAX_PROBES).map((name) => `Do you deliver to ${name}?`),
    pay: ['How do I pay?'],
  };
}

/** First question in a probe list that voice answers with found, else the first question. */
function firstFoundOrFirst(kind, profile, now) {
  const c = ctx(profile, now);
  const questions = readinessQuestions(profile)[kind];
  for (const query of questions) {
    if (lookup(kind, query, c)?.status === 'found') return query;
  }
  return questions[0] || '';
}

/** Desk preview defaults: a question that matches the readiness row verdict when possible. */
function previewSampleQuestions(profile, opts = {}) {
  const now = opts.now || new Date();
  const q = readinessQuestions(profile);
  return {
    price: firstFoundOrFirst('price', profile, now),
    hours: q.hours[0],
    delivery: firstFoundOrFirst('fee', profile, now),
    pay: q.pay[0],
  };
}

/** First found answer across the tenant's questions; otherwise the first result (or empty-query result). */
function probeKind(kind, profile, now) {
  const c = ctx(profile, now);
  const questions = readinessQuestions(profile)[kind];
  let first = null;
  for (const query of questions) {
    const result = lookup(kind, query, c);
    if (result?.status === 'found') return result;
    if (!first) first = result;
  }
  return first || lookup(kind, '', c);
}

const FACT_PROBES = {
  prices: (profile, now) => probeKind('price', profile, now),
  hours: (profile, now) => probeKind('hours', profile, now),
  areas: (profile, now) => probeKind('fee', profile, now),
  payment: (profile, now) => probeKind('pay', profile, now),
};

function factRow(kind, title, profile, now) {
  const probe = FACT_PROBES[kind];
  const result = probe(profile, now);
  const willSay = result?.status === 'found';
  const reasonKind = kind === 'areas' ? 'delivery' : kind === 'payment' ? 'payment' : kind;
  const hearPreview = willSay ? speechOf(result, 'en') : '';
  return {
    id: kind,
    title,
    isFact: true,
    willSay,
    stampTone: willSay ? 'ok' : 'attention',
    stampLabel: willSay ? 'Will say' : "Won't say",
    reason: ownerLookupReason(reasonKind, result),
    fixHref: FIX[kind],
    hearPreview,
    _lookupResult: result,
  };
}

function unsureRow(profile) {
  const byKind = profile?.unknownAnswerByKind;
  const generalCustom =
    String(byKind?.general?.en || '').trim() || String(byKind?.general?.sw || '').trim();
  const legacy = String(profile?.unknownAnswerFallback || '').trim();
  const kindKeys = ['general', 'price', 'hours', 'fee', 'pay'];
  const hasOverride = kindKeys.some((k) => {
    const row = byKind?.[k];
    return Boolean(String(row?.en || '').trim() || String(row?.sw || '').trim());
  });
  const hasLine = Boolean(generalCustom || legacy || hasOverride);
  return {
    id: 'unsure',
    title: 'When unsure',
    isFact: false,
    willSay: hasLine,
    stampTone: hasLine ? 'ok' : 'neutral',
    stampLabel: hasLine ? 'Will say' : 'Team default',
    reason: hasLine ? 'Callers hear your callback line.' : 'Team default until you write a line.',
    fixHref: FIX.unsure,
    hearPreview: legacy || generalCustom || '',
  };
}

function evaluateAssistantSay(profile, opts = {}) {
  const now = opts.now || new Date();
  const rows = [
    greetingRow(profile),
    factRow('prices', 'Prices and quotes', profile, now),
    factRow('hours', 'Opening hours', profile, now),
    factRow('areas', 'Delivery and areas', profile, now),
    factRow('payment', 'Payment details', profile, now),
    unsureRow(profile),
  ].map((row) => {
    if (!row._lookupResult) return row;
    const { _lookupResult, ...rest } = row;
    return rest;
  });
  const readyCount = rows.filter((r) => {
    if (r.id === 'unsure') return r.stampTone === 'ok';
    if (r.id === 'greeting') return r.willSay;
    return r.isFact && r.willSay;
  }).length;
  return { intro: INTRO, rows, readyCount, total: 6 };
}

function lookupProbeForRowId(rowId, profile, now) {
  if (!FACT_PROBES[rowId]) return null;
  return FACT_PROBES[rowId](profile, now);
}

const CHECKLIST_META = [
  { id: 'greeting', label: 'Greeting', href: '/settings?tab=assistant-say&topic=greeting', rowId: 'greeting' },
  { id: 'prices', label: 'Prices and quotes', href: '/settings?tab=assistant-say&topic=prices', rowId: 'prices' },
  { id: 'hours', label: 'Opening hours', href: '/settings?tab=assistant-say&topic=hours', rowId: 'hours' },
  { id: 'areas', label: 'Areas', href: '/settings?tab=assistant-say&topic=areas', rowId: 'areas' },
  { id: 'payment', label: 'Payment details', href: '/settings?tab=assistant-say&topic=payment', rowId: 'payment' },
  { id: 'unsure', label: 'When unsure', href: '/settings?tab=assistant-say&topic=unsure', rowId: 'unsure' },
];

function rowIsChecklistComplete(row) {
  if (row.id === 'unsure') return row.stampTone === 'ok';
  if (row.id === 'greeting') return row.willSay;
  return row.isFact && row.willSay;
}

function identityComplete(profile) {
  return Boolean(String(profile?.businessName || profile?.business_name || '').trim());
}

function getReadyChecklist(profile, opts = {}) {
  const say = evaluateAssistantSay(profile, opts);
  const byId = new Map(say.rows.map((r) => [r.id, r]));
  const items = CHECKLIST_META.map((meta) => {
    const row = meta.rowId ? byId.get(meta.rowId) : null;
    const complete = row ? rowIsChecklistComplete(row) : false;
    let reason = '';
    if (!complete && row) reason = row.reason || '';
    return { id: meta.id, label: meta.label, href: meta.href, complete, reason };
  });
  const allDone = items.every((i) => i.complete);
  return { items, allDone };
}

module.exports = {
  INTRO,
  evaluateAssistantSay,
  getReadyChecklist,
  lookupProbeForRowId,
  FACT_PROBES,
  readinessQuestions,
  previewSampleQuestions,
};
