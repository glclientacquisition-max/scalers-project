'use strict';
// Booking-for-me OFF: the Business Assistant offers to take a request for the team, never to "book".
const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/conversation/v2/receipts');
const M = require('../src/conversation/v2/machine');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const BOOK = /\b(book|booking|booked)\b|kubook|ukibook/i;
const SW_ASK = 'Nikuandikie ombi kwa timu?';
const EN_ASK = 'Shall I take a request for the team?';

test('offered: request mode asks to take a request (sw + en)', () => {
  const sw = R.info({ kind: 'offered', label: 'Carpet cleaning', request: true }, 'sw');
  const en = R.info({ kind: 'offered', label: 'Carpet cleaning', price: 'KSh 1,500', request: true }, 'en');
  assert.ok(sw.includes(SW_ASK), sw); assert.ok(en.includes(EN_ASK), en);
  assert.doesNotMatch(sw, BOOK); assert.doesNotMatch(en, BOOK);
});

test('offered: booking-for-me on keeps the booking offer', () => {
  assert.match(R.info({ kind: 'offered', label: 'Carpet cleaning', request: false }, 'en'), /Would you like to book\?/);
});

test('ack, coverage and service_slot: no "book" in request mode', () => {
  const lines = [];
  for (const lang of ['sw', 'en']) {
    lines.push(R.info({ kind: 'ack', service: 'Sofa cleaning', request: true }, lang));
    lines.push(R.info({ kind: 'coverage', area: { name: 'Kileleshwa', listed: true }, request: true }, lang));
    lines.push(R.info({ kind: 'service_slot', label: 'Sofa cleaning', request: true }, lang));
    lines.push(R.info({ kind: 'drop_intent', request: true }, lang));
  }
  for (const l of lines) assert.doesNotMatch(l, BOOK, l);
  assert.match(R.info({ kind: 'ack', service: 'Sofa cleaning', request: true }, 'sw'), /Nikuandikie ombi la Sofa cleaning kwa timu\?/);
  assert.ok(R.info({ kind: 'service_slot', label: 'Sofa cleaning', request: true }, 'en').includes(EN_ASK));
});

test('read-back and receipt for a visit: request wording, callback promise, no "booked"', () => {
  const p = { tool: 'create_booking', service: 'Sofa cleaning', when: { date: '2026-10-20', time: '10:00' }, place: 'Kileleshwa', request: true };
  for (const lang of ['sw', 'en']) {
    const rb = R.readback(p, lang); assert.doesNotMatch(rb, BOOK, rb);
    const rc = R.receipt({ ...p, ok: true }, lang); assert.doesNotMatch(rc, BOOK, rc);
    assert.match(rc, lang === 'sw' ? /ombi/ : /request/, rc);
    assert.match(rc, lang === 'sw' ? /kupigia/ : /call you back/, rc);
  }
  assert.match(R.receipt({ ...p, ok: true, request: false }, 'en'), /is booked for/);
});

test('intent clarifier is booking-neutral', () => {
  for (const lang of ['sw', 'en']) for (const n of [0, 1, 2]) {
    const l = R.ask('intent', n, lang); assert.doesNotMatch(String(l || ''), BOOK, l);
  }
});

test('machine: "do you do X?" with booking-for-me off offers a request', async () => {
  const V2 = require('../src/conversation/v2');
  const NOW = new Date('2026-10-14T05:00:00Z');
  const svc = (DD.servicesCatalog || []).find((s) => /sofa/i.test(s.name)) || DD.servicesCatalog[0];
  const run = async (policies) => {
    const profile = { ...DD, businessPolicies: policies };
    const st = V2.createState({ profile, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
    return (await V2.runTurn(st, { text: `Do you do ${svc.name.toLowerCase()}?`, profile, now: NOW, handlers: V2.createDryRunHandlers(), langLock: 'en' })).line || '';
  };
  const off = await run({ ...(DD.businessPolicies || {}), booking_mode: 'request' });
  assert.ok(off.length, 'line'); assert.doesNotMatch(off, BOOK, off);
});

test('v2 coverage: a listed area gives its owner-confirmed travel fee', async () => {
  const V2 = require('../src/conversation/v2');
  const AT = require('../src/conversation/areaTerms');
  const NOW = new Date('2026-10-14T05:00:00Z');
  const service_areas = { areas: [{ id: 'place:kileleshwa', eta: 'Same day', modes: ['visit'], source: 'owner', fee_ksh: 300, fee_mode: 'fixed', confirmed: true }] };
  const profile = { ...DD, serviceAreas: service_areas, areaTerms: AT.readAreaTerms(service_areas), businessPolicies: { ...(DD.businessPolicies || {}), booking_mode: 'request', coverage_areas: ['place:kileleshwa'] } };
  for (const [lang, re] of [['en', /KSh 300/], ['sw', /shilingi 300/]]) {
    const st = V2.createState({ profile, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
    const text = lang === 'sw' ? 'Mnafika Kileleshwa, karibu na Valley Arcade?' : 'Do you come to Kileleshwa, near Valley Arcade?';
    const line = (await V2.runTurn(st, { text, profile, now: NOW, handlers: V2.createDryRunHandlers(), langLock: lang })).line || '';
    assert.match(line, re, line); assert.doesNotMatch(line, BOOK, line);
  }
});
