'use strict';

const { lookup } = require('./lookup');

const INTRO =
  'These are the answers your Business Assistant gives callers. Anything it cannot answer, it takes a message and your team calls back.';

const FIX = {
  prices: '/settings?tab=catalog',
  hours: '/settings?tab=train&panel=hours',
  delivery: '/settings?tab=train&panel=locations',
  payment: '/settings?tab=train&panel=policies',
  unsure: '/settings?tab=assistant-say',
};

function ctx(profile, now) {
  return { profile, language: 'en', now: now || new Date(), seed: 0 };
}

function plainReason(kind, result) {
  const status = result?.status;
  const reason = result?.reason;
  if (status === 'found') return null;
  if (kind === 'prices') {
    if (reason === 'price_quote' || status === 'not_on_file') return "Price is 'ask for a quote', so it takes a message.";
    if (status === 'unconfirmed') return 'Imported, press Save once to use it.';
    return 'Not added yet.';
  }
  if (kind === 'hours') {
    if (status === 'unconfirmed') return 'Imported, press Save once to use it.';
    return 'Not added yet.';
  }
  if (kind === 'delivery') {
    if (status === 'unconfirmed') return 'Imported, press Save once to use it.';
    if (status === 'no_data') return 'Not added yet.';
    return 'Not added yet.';
  }
  if (kind === 'payment') {
    if (status === 'unconfirmed') return 'Imported, press Save once to use it.';
    return 'Not added yet.';
  }
  return 'Not added yet.';
}

function row(kind, title, probe, profile, now) {
  const result = probe(profile, now);
  const willSay = result?.status === 'found';
  return {
    id: kind,
    title,
    willSay,
    reason: willSay ? 'Ready on the next call.' : plainReason(kind, result),
    fixHref: FIX[kind],
  };
}

function evaluateAssistantSay(profile, opts = {}) {
  const now = opts.now || new Date();
  const c = (p) => ctx(p, now);
  const rows = [
    row('prices', 'Prices and quotes', (p) => lookup('price', 'sample item', c(p)), profile, now),
    row('hours', 'Opening hours', (p) => lookup('hours', 'today', c(p)), profile, now),
    row(
      'delivery',
      'Delivery and areas',
      (p) => lookup('fee', 'delivery fee', c(p)),
      profile,
      now
    ),
    row('payment', 'Payment and till', (p) => lookup('pay', 'till number', c(p)), profile, now),
    {
      id: 'unsure',
      title: 'When unsure',
      willSay: Boolean(String(profile?.unknownAnswerFallback || '').trim()),
      reason: 'Fallback lines offer a callback only.',
      fixHref: FIX.unsure,
    },
  ];
  const readyCount = rows.filter((r) => r.willSay).length;
  return { intro: INTRO, rows, readyCount, total: rows.length };
}

const CHECKLIST = [
  { id: 'identity', label: 'Business name', href: '/settings?tab=train&panel=identity', done: (t) => Boolean(String(t.businessName || t.business_name || '').trim()) },
  { id: 'catalog', label: 'Catalogue and prices', href: '/settings?tab=catalog', done: (t) => {
    const services = Array.isArray(t.servicesCatalog || t.services_catalog) ? (t.servicesCatalog || t.services_catalog) : [];
    const products = Array.isArray(t.productCatalog || t.product_catalog) ? (t.productCatalog || t.product_catalog) : [];
    return services.some((r) => String(r?.name || '').trim()) || products.some((r) => String(r?.name || '').trim());
  }},
  { id: 'hours', label: 'Opening hours', href: '/settings?tab=train&panel=hours', done: (t) => Boolean(t.hoursSchedule || t.hours_schedule) },
  { id: 'payment', label: 'M-Pesa till', href: '/settings?tab=train&panel=policies', done: (t) => {
    const pol = t.businessPolicies || t.business_policies;
    const pay = pol && typeof pol === 'object' ? pol.payments : null;
    return Boolean(pay && Array.isArray(pay.methods) && pay.methods.length);
  }},
];

function getReadyChecklist(profile) {
  const items = CHECKLIST.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
    complete: item.done(profile),
  }));
  const allDone = items.every((i) => i.complete);
  return { items, allDone };
}

module.exports = {
  INTRO,
  evaluateAssistantSay,
  getReadyChecklist,
};
