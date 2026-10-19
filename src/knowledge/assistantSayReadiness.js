'use strict';

const { lookup } = require('./lookup');
const { ownerLookupReason } = require('./lookupOwnerReason');

const INTRO =
  'These are the answers your Business Assistant gives callers. Anything it cannot answer, it takes a message and your team calls back.';

const FIX = {
  prices: '/settings?tab=catalog',
  hours: '/settings?tab=train&panel=hours',
  delivery: '/settings?tab=train&panel=locations',
  payment: '/settings?tab=train&panel=policies',
  unsure: '/settings?tab=train&panel=policies',
};

function ctx(profile, now) {
  return { profile, language: 'en', now: now || new Date(), seed: 0 };
}

function catalogNames(profile) {
  const raw = profile?.servicesCatalog || profile?.services_catalog || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => String(row?.name || '').trim()).filter(Boolean);
}

function probePrices(profile, now) {
  const c = ctx(profile, now);
  const queries = ['How much is sofa cleaning?'];
  for (const name of catalogNames(profile)) {
    queries.push(`How much is ${name}?`);
  }
  let fallback = null;
  for (const query of queries) {
    const result = lookup('price', query, c);
    if (result?.status === 'found') return result;
    if (!fallback) fallback = result;
  }
  return fallback || lookup('price', 'How much is sofa cleaning?', c);
}

const FACT_PROBES = {
  prices: probePrices,
  hours: (profile, now) => lookup('hours', 'What are your opening hours?', ctx(profile, now)),
  delivery: (profile, now) => lookup('fee', 'Do you deliver to Kilimani?', ctx(profile, now)),
  payment: (profile, now) => lookup('pay', 'What is your till number?', ctx(profile, now)),
};

function factRow(kind, title, profile, now) {
  const probe = FACT_PROBES[kind];
  const result = probe(profile, now);
  const willSay = result?.status === 'found';
  const reasonKind = kind === 'delivery' ? 'delivery' : kind === 'payment' ? 'payment' : kind;
  return {
    id: kind,
    title,
    isFact: true,
    willSay,
    stampTone: willSay ? 'ok' : 'attention',
    stampLabel: willSay ? 'Will say' : "Won't say",
    reason: ownerLookupReason(reasonKind, result),
    fixHref: FIX[kind],
    _lookupResult: result,
  };
}

function unsureRow(profile) {
  const custom = String(profile?.unknownAnswerFallback || '').trim();
  const hasLine = Boolean(custom);
  return {
    id: 'unsure',
    title: 'When unsure',
    isFact: false,
    willSay: false,
    stampTone: hasLine ? 'ok' : 'neutral',
    stampLabel: hasLine ? 'Callback line set' : 'Using team default',
    reason: hasLine ? 'Callers hear your callback line.' : 'Team default until you write a line.',
    fixHref: FIX.unsure,
  };
}

function evaluateAssistantSay(profile, opts = {}) {
  const now = opts.now || new Date();
  const rows = [
    factRow('prices', 'Prices and quotes', profile, now),
    factRow('hours', 'Opening hours', profile, now),
    factRow('delivery', 'Delivery and areas', profile, now),
    factRow('payment', 'Payment and till', profile, now),
    unsureRow(profile),
  ].map((row) => {
    if (!row._lookupResult) return row;
    const { _lookupResult, ...rest } = row;
    return rest;
  });
  const readyCount = rows.filter((r) => r.isFact && r.willSay).length;
  const factTotal = rows.filter((r) => r.isFact).length;
  return { intro: INTRO, rows, readyCount, total: factTotal };
}

function lookupProbeForRowId(rowId, profile, now) {
  if (!FACT_PROBES[rowId]) return null;
  return FACT_PROBES[rowId](profile, now);
}

const CHECKLIST_META = [
  { id: 'identity', label: 'Business name', href: '/settings?tab=train&panel=identity', rowId: null },
  { id: 'catalog', label: 'Catalogue and prices', href: '/settings?tab=catalog', rowId: 'prices' },
  { id: 'hours', label: 'Opening hours', href: '/settings?tab=train&panel=hours', rowId: 'hours' },
  { id: 'payment', label: 'M-Pesa till', href: '/settings?tab=train&panel=policies', rowId: 'payment' },
];

function identityComplete(profile) {
  return Boolean(String(profile?.businessName || profile?.business_name || '').trim());
}

function getReadyChecklist(profile, opts = {}) {
  const say = evaluateAssistantSay(profile, opts);
  const byId = new Map(say.rows.map((r) => [r.id, r]));
  const items = CHECKLIST_META.map((meta) => {
    let complete = false;
    if (meta.rowId) {
      complete = byId.get(meta.rowId)?.willSay === true;
    } else {
      complete = identityComplete(profile);
    }
    let reason = '';
    if (!complete) {
      if (meta.rowId) {
        reason = byId.get(meta.rowId)?.reason || '';
      } else if (!identityComplete(profile)) {
        reason = 'Add your business name.';
      }
    }
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
};
