'use strict';
// Payment questions on the v2 quick-answer path. Only owner-confirmed text is used: the
// payment policy (and its structured methods, which share its confirmation) and confirmed
// payment FAQs. A method is named only when that text names it. Numbers are never read out.
const P = require('../provenance');

const METHODS = [
  ['mpesa_paybill', /\bpay ?bill\b/i, ['M-Pesa Paybill', 'M-Pesa Paybill']],
  ['mpesa_till', /\btill\b|buy goods/i, ['M-Pesa Till', 'M-Pesa Till']],
  ['mpesa', /\bm-?pesa\b/i, ['M-Pesa', 'M-Pesa']],
  ['airtel', /\bairtel\b/i, ['Airtel Money', 'Airtel Money']],
  ['pochi', /\bpochi\b/i, ['Pochi la Biashara', 'Pochi la Biashara']],
  ['bank', /\bbank\b|\bbenki\b/i, ['bank transfer', 'benki']],
  ['card', /\b(card|cards|visa|mastercard)\b|\bkadi\b/i, ['card', 'kadi']],
  ['cash', /\bcash\b|pesa taslimu|\bkeshi\b/i, ['cash', 'pesa taslimu']],
];
const STRUCT = { mpesa_paybill: 'mpesa_paybill', mpesa_till: 'mpesa_till', mpesa_send: 'mpesa', bank: 'bank', cash: 'cash', card: 'card', pochi: 'pochi', airtel: 'airtel' };
const PAY_FAQ = /\b(pay|payment|m-?pesa|till|pay ?bill|cash|card|lipa|malipo)\b/i;
const MPESA_KINDS = ['mpesa', 'mpesa_till', 'mpesa_paybill'];

function methodsIn(text) {
  const out = [];
  for (const [id, re] of METHODS) if (re.test(text)) out.push(id);
  if (out.includes('mpesa_till') || out.includes('mpesa_paybill')) return out.filter((m) => m !== 'mpesa');
  return out;
}
function confirmedPayment(profile = {}) {
  const policy = P.factPolicyMap(profile.businessPolicies, profile.fieldMeta || null).policies.payment || '';
  const faqs = P.factFaqs(profile.faqs, profile.fieldMeta || null).filter((f) => PAY_FAQ.test(`${f.question} ${f.answer}`));
  const structured = policy ? ((profile.businessPolicies?.payments?.methods) || []).map((m) => STRUCT[m]).filter(Boolean) : [];
  const corpus = [policy, ...faqs.map((f) => f.answer)].join(' ');
  const methods = [...new Set([...structured, ...methodsIn(corpus)])];
  return { policy, faq: faqs[0] || null, methods, corpus };
}
function askedMethod(text) { const m = methodsIn(String(text || '')); return m[0] || null; }
const label = (id, sw) => (METHODS.find((x) => x[0] === id) || [, , [id, id]])[2][sw ? 1 : 0];
const list = (ids, sw) => { const xs = ids.map((m) => label(m, sw)); return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${sw ? 'au' : 'or'} ${xs[xs.length - 1]}` : xs[0]; };

function paymentLine(profile, text, lang) {
  const sw = /^(sw|sheng)/.test(String(lang || ''));
  const c = confirmedPayment(profile);
  if (!c.methods.length) return sw ? 'Sina maelezo ya malipo yaliyothibitishwa. Timu itakuthibitishia watakapokupigia.' : "I don't have confirmed payment details. The team will confirm when they call you back.";
  const asked = askedMethod(text);
  const accepted = asked ? c.methods.includes(asked) || (asked === 'mpesa' && c.methods.some((m) => MPESA_KINDS.includes(m))) : null;
  // English: the owner's own FAQ answer, when it fits the question and reads out no numbers
  if (!sw && c.faq && accepted !== false && !/\d{5,}/.test(c.faq.answer)) return c.faq.answer.trim();
  const after = /\b(after the job|once the job is done|after (the )?(work|service|cleaning)|when the job is done)\b/i.test(c.corpus);
  const noUpfront = /\b(no payment before|never ask for payment before|don'?t ask for payment before|no upfront)\b/i.test(c.corpus);
  const head = asked ? (accepted ? (sw ? 'Ndio. ' : 'Yes. ') : (sw ? `Siwezi kuthibitisha ${label(asked, true)}. ` : `I can't confirm ${label(asked, false)}. `)) : '';
  const body = sw ? `Tunapokea ${list(c.methods, true)}.` : `We accept ${list(c.methods, false)}.`;
  const when = after ? (sw ? ' Unalipa baada ya kazi kukamilika.' : ' You pay once the job is done.') : '';
  const up = noUpfront ? (sw ? ' Hatuombi malipo mapema.' : ' We never ask for payment upfront.') : '';
  return `${head}${body}${when}${up}`;
}
module.exports = { paymentLine, confirmedPayment, askedMethod, methodsIn };
