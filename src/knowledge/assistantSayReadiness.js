'use strict';

const { lookup } = require('./lookup');

const INTRO =
  'These are the answers your Business Assistant gives callers. Anything it cannot answer, it takes a message and your team calls back.';

const FIX = {
  prices: '/settings?tab=catalog',
  hours: '/settings?tab=train&panel=hours',
  delivery: '/settings?tab=train&panel=locations',
  payment: '/settings?tab=train&panel=policies',
  unsure: '/settings?tab=train&panel=policies',
};

const SAVE_ON = {
  prices: 'Catalogue',
  hours: 'Hours',
  delivery: 'Locations',
  payment: 'Policies',
};

function ctx(profile, now) {
  return { profile, language: 'en', now: now || new Date(), seed: 0 };
}

function plainReason(kind, result) {
  const status = result?.status;
  const reason = result?.reason;
  if (status === 'found') return 'Ready on the next call.';
  const saveLabel = SAVE_ON[kind];
  if (status === 'unconfirmed' && saveLabel) {
    return `Imported from your notes. Press Save on ${saveLabel} to use it.`;
  }
  if (kind === 'prices') {
    if (reason === 'price_quote' || status === 'not_on_file') {
      return "Price is ask for a quote, so it takes a message.";
    }
    return 'Add items and prices on Catalogue.';
  }
  if (kind === 'hours') return 'Add your opening hours.';
  if (kind === 'delivery') {
    if (status === 'no_data') return 'Add delivery areas on Locations.';
    return 'Add delivery areas on Locations.';
  }
  if (kind === 'payment') return 'Add how customers pay on Policies.';
  return 'Not added yet.';
}

function factRow(kind, title, probe, profile, now) {
  const result = probe(profile, now);
  const willSay = result?.status === 'found';
  return {
    id: kind,
    title,
    isFact: true,
    willSay,
    stampTone: willSay ? 'ok' : 'attention',
    stampLabel: willSay ? 'Will say' : "Won't say",
    reason: plainReason(kind, result),
    fixHref: FIX[kind],
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
  const c = (p) => ctx(p, now);
  const rows = [
    factRow('prices', 'Prices and quotes', (p) => lookup('price', 'sample item', c(p)), profile, now),
    factRow('hours', 'Opening hours', (p) => lookup('hours', 'today', c(p)), profile, now),
    factRow(
      'delivery',
      'Delivery and areas',
      (p) => lookup('fee', 'delivery fee', c(p)),
      profile,
      now
    ),
    factRow('payment', 'Payment and till', (p) => lookup('pay', 'till number', c(p)), profile, now),
    unsureRow(profile),
  ];
  const readyCount = rows.filter((r) => r.isFact && r.willSay).length;
  const factTotal = rows.filter((r) => r.isFact).length;
  return { intro: INTRO, rows, readyCount, total: factTotal };
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
    return { id: meta.id, label: meta.label, href: meta.href, complete };
  });
  const allDone = items.every((i) => i.complete);
  return { items, allDone };
}

module.exports = {
  INTRO,
  evaluateAssistantSay,
  getReadyChecklist,
};
