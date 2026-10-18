'use strict';
// Anonymised tenant shapes for the lookup replay. Fictional business only.

const FALLBACK = "I'll check with the team and they'll call you back.";

function day(open, close) {
  return open ? { open, close } : null;
}

function week(open, close, sundayClosed) {
  return {
    timezone: 'Africa/Nairobi',
    days: {
      mon: day(open, close),
      tue: day(open, close),
      wed: day(open, close),
      thu: day(open, close),
      fri: day(open, close),
      sat: day(open, close),
      sun: sundayClosed ? null : day(open, close),
    },
  };
}

function area(id, feeKsh) {
  return {
    id,
    modes: ['visit'],
    source: 'owner',
    confirmed: true,
    fee_mode: feeKsh == null ? 'free' : 'fixed',
    fee_ksh: feeKsh,
  };
}

function service(name, price) {
  return { name, price_range: price, source: 'owner', confirmed: true };
}

function base(extra = {}) {
  return {
    businessName: 'Usafi Mtaa',
    agentName: 'Akinyi',
    vertical: 'home_services',
    unknownAnswerFallback: FALLBACK,
    hoursSchedule: week('08:00', '18:00', true),
    service_areas: {
      areas: [
        area('place:kilimani', null),
        area('place:kileleshwa', 300),
        area('place:ongata rongai', 400),
      ],
    },
    servicesCatalog: [
      service('Deep cleaning', 'KSh 2,500'),
      service('Sofa cleaning', 'From KSh 2,500'),
    ],
    ...extra,
  };
}

function profiles() {
  return {
    carry: base(),
    list: base({
      servicesCatalog: [
        service('Deep cleaning', 'KSh 6,500'),
        service('Standard cleaning', 'KSh 4,500'),
        service('Sofa cleaning', 'KSh 2,500'),
        service('Carpet cleaning', 'KSh 1,500'),
        service('Move-out cleaning', 'KSh 8,000'),
      ],
    }),
    ask: base({
      servicesCatalog: [
        service('Sofa cleaning', 'KSh 2,500'),
        service('Window cleaning', 'Ask'),
      ],
    }),
    range: base({
      servicesCatalog: [
        {
          name: 'Oven cleaning',
          pricing_mode: 'range',
          price: '1,500',
          price_max: '2,500',
          price_range: 'Ask',
          source: 'owner',
          confirmed: true,
        },
      ],
    }),
    quote: base({
      servicesCatalog: [
        {
          name: 'Gutter cleaning',
          pricing_mode: 'quote',
          price: '4,500',
          source: 'owner',
          confirmed: true,
        },
      ],
    }),
    stale: base({
      servicesCatalog: [service('Deep cleaning', 'KSh 2,500')],
      llmSystemPrompt: 'PRICES:\nDeep clean KSh 9,500.\nOpen from 7:41 AM.',
    }),
    hours: base({
      hoursSchedule: week('08:00', '18:00', false),
    }),
    rongai: base(),
    nowhere: {
      businessName: 'Usafi Mtaa',
      agentName: 'Akinyi',
      vertical: 'home_services',
      unknownAnswerFallback: FALLBACK,
      servicesCatalog: [service('Sofa cleaning', 'KSh 2,500')],
    },
    grouped: base({
      hoursSchedule: {
        timezone: 'Africa/Nairobi',
        days: {
          mon: day('09:00', '19:00'),
          tue: day('09:00', '19:00'),
          wed: day('09:00', '19:00'),
          thu: day('09:00', '19:00'),
          fri: day('09:00', '19:00'),
          sat: day('09:00', '19:00'),
          sun: null,
        },
      },
    }),
    menu: base({
      servicesCatalog: [
        service('Sofa cleaning', 'KSh 2,500'),
        service('Carpet cleaning', 'KSh 1,500'),
        service('Mattress Cleaning', 'KSh 3,000'),
        service('Curtain cleaning', 'KSh 1,800'),
        service('Oven cleaning', 'KSh 2,000'),
      ],
    }),
    optout: (() => {
      const row = base();
      return {
        ...row,
        service_areas: { ...row.service_areas, decline_unlisted: true },
      };
    })(),
  };
}

module.exports = { profiles, FALLBACK };
