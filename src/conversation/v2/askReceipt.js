'use strict';
// One ask ticket, one shop line. Same split Lex, Dialogflow CX, and PolyAI use:
// NLU picks a label and an optional place; fulfillment reads the shop file.
// The model never writes a fee, a policy, or a booking sentence.

const N = require('./nlu');
const { applyTicket, needsClassify, normalizeTicket } = require('./classifyAsk');
const { compileSpokenVisitFee, compileSpokenPolicies } = require('../spokenFacts');

const WRITE = new Set(['cancel_visit', 'book']);

const PAY_LABEL = {
  mpesa_paybill: ['M-Pesa Paybill', 'M-Pesa Paybill'],
  mpesa_till: ['M-Pesa Till', 'M-Pesa Till'],
  bank: ['bank transfer', 'benki'],
  cash: ['cash', 'pesa taslimu'],
  card: ['card', 'kadi'],
  pochi: ['Pochi la Biashara', 'Pochi la Biashara'],
  airtel: ['Airtel Money', 'Airtel Money'],
};

function sw(language) {
  const lang = String(language || 'en').toLowerCase();
  return lang === 'sw' || lang === 'sheng' || lang.startsWith('swahili');
}

function paymentLine(profile = {}, language = 'en') {
  const methods = (profile.businessPolicies?.payments?.methods || [])
    .map((id) => PAY_LABEL[id]?.[sw(language) ? 1 : 0])
    .filter(Boolean);
  if (methods.length) {
    const joined = methods.join(', ').replace(/, ([^,]+)$/, sw(language) ? ' au $1' : ' or $1');
    return sw(language) ? `Malipo: ${joined}.` : `You can pay by ${joined}.`;
  }
  return compileSpokenPolicies(profile).line('payment', language);
}

function compileAskReceipt(profile, ticket = {}, language = 'en') {
  const kind = ticket.kind;
  const place = ticket.place || (ticket.area && ticket.area.name) || null;
  if (!kind || WRITE.has(kind) || kind === 'unknown') return '';
  if (kind === 'come_cost') return compileSpokenVisitFee(profile, place, language);
  if (kind === 'cover') return compileSpokenVisitFee(profile, place, language);
  if (kind === 'pay') return paymentLine(profile, language);
  if (kind === 'refund') return compileSpokenPolicies(profile).line('returns', language);
  if (kind === 'cancel_rules') return compileSpokenPolicies(profile).line('cancellation', language);
  if (kind === 'deposit') return compileSpokenPolicies(profile).line('deposit', language);
  if (kind === 'warranty') return compileSpokenPolicies(profile).line('warranty', language);
  return '';
}

// R3: travel/delivery fee only — bare how much|ngapi is not come_cost on a coverage ticket.
function feeAsk(text, u) {
  return Boolean(u.feeAsk) || /\b(fare|ada ya(?:\s+kuja)?|travel fee|delivery fee|fee to|usafiri|come cost|gharama ya kuja)\b|\b(how much|ngapi|bei).{0,40}\b(to (?:come|visit|deliver|kuja)|kuja|usafiri|fare|travel|delivery)\b|\b(to (?:come|visit|deliver)|kuja|usafiri|fare|travel|delivery).{0,40}\b(how much|ngapi|bei)\b/i.test(String(text || ''));
}

function ticketFromUnderstand(u) {
  if (u.intents.includes('policy_cancel')) {
    return { job: 'speak', kind: 'cancel_rules', place: null };
  }
  if (u.intents.includes('cancel')) {
    return { job: 'write', kind: 'cancel_visit', place: null };
  }
  if (u.intents.includes('book') && !u.intents.some((i) => i !== 'book' && i !== 'want_know' && i !== 'price')) {
    return { job: 'write', kind: 'book', place: u.area ? u.area.name : null };
  }
  if (u.intents.includes('payment_how')) {
    return { job: 'speak', kind: 'pay', place: null };
  }
  if (u.intents.includes('policy_returns')) {
    return { job: 'speak', kind: 'refund', place: null };
  }
  if (u.intents.includes('policy_deposit')) {
    return { job: 'speak', kind: 'deposit', place: null };
  }
  if (u.intents.includes('policy_warranty')) {
    return { job: 'speak', kind: 'warranty', place: null };
  }
  if (u.intents.includes('coverage')) {
    const place = u.area && u.area.name;
    return { job: 'speak', kind: feeAsk(u.text, u) ? 'come_cost' : 'cover', place };
  }
  if (u.intents.includes('hours')) {
    return { job: 'speak', kind: 'hours', place: null };
  }
  if (u.intents.includes('services')) {
    return { job: 'speak', kind: 'service', place: null };
  }
  return { job: 'drop', kind: 'unknown', place: u.area ? u.area.name : null };
}

function resolveAsk({ text, profile = {}, lang = 'en', classify = null, now = new Date(), ticket: forced } = {}) {
  const u = N.understand(text, { profile, now });
  if (forced) applyTicket(u, normalizeTicket(forced, profile));
  let ticket = ticketFromUnderstand(u);
  const transactional = ticket.job === 'write';
  return Promise.resolve()
    .then(async () => {
      if (!forced && typeof classify === 'function' && needsClassify(u, transactional)) {
        applyTicket(u, normalizeTicket(await classify({ text: u.text, profile, lang }), profile));
        ticket = ticketFromUnderstand(u);
      }
      const line = ticket.job === 'speak' ? compileAskReceipt(profile, ticket, lang) : '';
      return { ...ticket, line, text: u.text };
    });
}

module.exports = {
  compileAskReceipt,
  ticketFromUnderstand,
  resolveAsk,
  paymentLine,
};
