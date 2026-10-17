'use strict';
// v2 quick-answer path: payment questions answered from owner-confirmed text only; compound
// service+price / area+fee questions answer both parts; a "yes" to a request offer moves on.
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const AT = require('../src/conversation/areaTerms');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const NOW = new Date('2026-10-14T05:00:00Z');
const BOOK = /\b(book|booking|booked)\b|kubook|ukibook/i;
const MPESA_FAQ = { question: 'Do you take M-Pesa?', answer: 'Yes. You pay by M-Pesa, to our Till number, once the job is done and you are happy with it. Cash is fine too. We never ask for payment before the team arrives.', source: 'owner', confirmed: true, status: 'confirmed' };
const AREAS = { areas: [{ id: 'place:kileleshwa', eta: 'Same day', modes: ['visit'], source: 'owner', fee_ksh: 300, fee_mode: 'fixed', confirmed: true }] };

function jirani(over = {}) {
  const services = DD.servicesCatalog.map((s) => (/carpet/i.test(s.name) ? { ...s, price_range: '', pricing: null } : s));
  return {
    ...DD,
    servicesCatalog: services,
    faqs: [MPESA_FAQ],
    serviceAreas: AREAS,
    areaTerms: AT.readAreaTerms(AREAS),
    businessPolicies: { ...DD.businessPolicies, payments: null, payment: 'M-Pesa (Till) or cash after the job. No payment before the team arrives.', booking_mode: 'request', coverage_areas: ['place:kileleshwa'] },
    ...over,
  };
}
async function talk(profile, lines, lang) {
  const st = V2.createState({ profile, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
  const out = [];
  for (const text of lines) out.push((await V2.runTurn(st, { text, profile, now: NOW, handlers: V2.createDryRunHandlers(), langLock: lang })).line || '');
  return out;
}

test('payment: English yes/no question uses the owner-confirmed FAQ', async () => {
  const [l] = await talk(jirani(), ['Do you take M-Pesa?'], 'en');
  assert.match(l, /M-Pesa/); assert.match(l, /once the job is done/); assert.doesNotMatch(l, /How can I help/);
});

test('payment: Swahili questions answer in Swahili from confirmed text', async () => {
  const [a] = await talk(jirani(), ['Mnakubali M-Pesa?'], 'sw');
  assert.match(a, /^Ndio\. Tunapokea M-Pesa Till au pesa taslimu\./, a);
  assert.match(a, /baada ya kazi/, a);
  const [b] = await talk(jirani(), ['Nalipa aje?'], 'sw');
  assert.match(b, /Tunapokea M-Pesa Till au pesa taslimu/, b);
  assert.doesNotMatch(b, /tukusaidie vipi/i);
});

test('payment: a method not in the confirmed text is never confirmed', async () => {
  const [l] = await talk(jirani(), ['Do you take card?'], 'en');
  assert.match(l, /can't confirm card/i, l); assert.match(l, /M-Pesa Till or cash/, l);
  const [s] = await talk(jirani(), ['Mnakubali kadi?'], 'sw');
  assert.match(s, /Siwezi kuthibitisha kadi/, s);
});

test('payment: nothing confirmed -> the team confirms on the callback; unconfirmed FAQs are never spoken', async () => {
  const p = jirani({ faqs: [{ question: 'Do you take Bitcoin?', answer: 'Yes, Bitcoin and M-Pesa.', source: 'import', confirmed: false }], businessPolicies: { ...DD.businessPolicies, payments: null, payment: '', booking_mode: 'request' } });
  const [en] = await talk(p, ['Do you take M-Pesa?'], 'en');
  assert.match(en, /team will confirm/i, en); assert.doesNotMatch(en, /Bitcoin|M-Pesa/, en);
  const [sw] = await talk(p, ['Nalipa aje?'], 'sw');
  assert.match(sw, /Timu itakuthibitishia/, sw); assert.doesNotMatch(sw, /Bitcoin|M-Pesa/, sw);
});

test('payment: Done and Dusted structured methods still answer and never read numbers', async () => {
  const [l] = await talk(DD, ['Nilikuwa nauliza, ni vipi naweza lipa?'], 'sw');
  assert.match(l, /^Tunapokea M-Pesa Paybill/); assert.doesNotMatch(l, /\d{5}/);
});

test('service + price, no listed price: says so, offers a request; "yes" moves on to details', async () => {
  for (const [lang, lines, re] of [['sw', ['Mnasafisha carpet? Ni bei gani?', 'Ndio'], /bei/], ['en', ['Do you clean carpets? How much?', 'Yes'], /no listed price/]]) {
    const [a, b] = await talk(jirani(), lines, lang);
    assert.match(a, re, a); assert.match(a, lang === 'sw' ? /atakupigia na bei/ : /call you with a quote/, a);
    assert.match(a, lang === 'sw' ? /Nikuandikie ombi kwa timu\?/ : /Shall I take a request for the team\?/, a);
    assert.doesNotMatch(b, /Nikuandikie ombi|take a request|call you back to finish/, b);
    assert.match(b, /\?/, b); assert.doesNotMatch(a + b, BOOK);
  }
});

test('price only, no listed price: "yes" to the quote moves on to details (home services)', async () => {
  const [a, b] = await talk(jirani(), ['How much is carpet cleaning?', 'Yes'], 'en');
  assert.match(a, /don't have a price/, a);
  assert.doesNotMatch(b, /call you back to finish|Would you like the owner/, b);
});

test('a yes after the repeated request offer moves on (no loop)', async () => {
  const [, b, c] = await talk(jirani(), ['Mnafanya sofa?', 'Sawa', 'Ndio'], 'sw');
  assert.doesNotMatch(c, /Nikuandikie ombi/, `${b} | ${c}`);
});

test('area + fee questions give the confirmed fee (both languages)', async () => {
  for (const [lang, text, re] of [['en', 'Do you come to Kileleshwa? What is the fee?', /KSh 300/], ['en', 'How much is the travel fee to Kileleshwa?', /KSh 300/], ['sw', 'Mnafika Kileleshwa? Ni bei gani kufika?', /shilingi 300/], ['sw', 'Ni bei gani kufika Kileleshwa?', /shilingi 300/]]) {
    const [l] = await talk(jirani(), [text], lang);
    assert.match(l, re, `${text} -> ${l}`);
  }
});
