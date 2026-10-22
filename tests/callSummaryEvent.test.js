// Run: node --test tests/callSummaryEvent.test.js
// A4: one owner summary per call. Brain's `call.summary.ready` builder (v1 path).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CALL_SUMMARY_EVENT = 'on';
const E = require('../src/conversation/callSummaryEvent');
const { createBrainState, recordActionResults } = require('../src/conversation/brainState');

const RETAIL = {
  id: 'ten_aris', vertical: 'retail',
  productCatalog: [
    { id: 'prd_protractor', name: 'Protractor', price: '50', in_stock: null },
    { id: 'prd_tsquare', name: 'T-square', pricing: { mode: 'range', unit: 'each', min_ksh: 800, max_ksh: 1200 }, in_stock: true },
  ],
};
const HOME = {
  id: 'ten_jirani', vertical: 'home_services',
  servicesCatalog: [{ id: 'svc_deep1', name: 'Deep clean, 1 bedroom', pricing: { mode: 'fixed', amount_ksh: 6500 }, in_stock: '' }],
};
const t = (speaker, text) => ({ speaker, text });

function state(profile, { intent, entities = {}, results = [], lang = 'en', name = null } = {}) {
  let s = createBrainState(profile);
  s.intent = intent || 'unknown';
  s.entities = entities;
  s.language.current = lang;
  if (name) s.caller.name = name;
  if (results.length) s = recordActionResults(s, results);
  return s;
}
function build(profile, st, turns, extra = {}) {
  const receipts = E.receiptsFromV1({ brainState: st, turns, profile });
  const out = E.buildCallSummaryEvent({
    path: 'v1', callLanguage: st.language.current, callId: 'call_1', tenantId: profile.id,
    answered: true, caller: { phone: '+254700000001', name: E.v1CallerName(st) }, receipts,
    now: new Date('2026-10-21T08:00:00Z'), ...extra,
  });
  assert.equal(out.ok, true, out.errors.join('; '));
  return out.event;
}
const confirmed = (e) => e.receipts.filter((r) => r.status === 'confirmed');

test('HD_8a8aa14db292 synthetic: "in stock" said, no write → info_only, stock unconfirmed, 0 confirmed', () => {
  const st = state(RETAIL, { intent: 'order', entities: { product: { value: 'Protractor' } } });
  const e = build(RETAIL, st, [
    t('caller', 'Do you have a protractor?'),
    t('agent', 'Yes, the protractor is in stock.'),
    t('caller', 'Okay I will come.'),
  ]);
  assert.equal(e.outcome, 'info_only');
  assert.equal(confirmed(e).length, 0);
  assert.equal(e.receipts.length, 1);
  const [r] = e.receipts;
  assert.equal(r.type, 'order');
  assert.equal(r.status, 'unconfirmed');
  assert.equal(r.writtenRowId, undefined);
  assert.equal(r.items[0].stock, 'unconfirmed', 'null in_stock is never "in stock"');
  assert.equal(r.items[0].catalogueId, 'prd_protractor');
  assert.deepEqual(r.items[0].unitPrice, { min: 50, max: 50, unit: 'each' });
  assert.equal(e.urgent, false);
});

test('HD_e75a669780d4 synthetic: order row written, no quantity, no read-back → unconfirmed, qty not_given', () => {
  const st = state(RETAIL, {
    intent: 'order', name: 'Chris',
    results: [{ action: 'create_service_request', status: 'succeeded', id: 'sr_e75a', requestType: 'order', value: { type: 'order', item: 'Protractor', whenText: 'kesho' } }],
  });
  const e = build(RETAIL, st, [
    t('caller', 'Mimi naitwa Chris.'),
    t('caller', 'Repeat what I ordered.'),
    t('agent', 'Sawa.'),
  ]);
  const [r] = e.receipts;
  assert.equal(r.type, 'order');
  assert.equal(r.status, 'unconfirmed', 'a written row without a read-back + yes is not confirmed');
  assert.equal(r.writtenRowId, 'sr_e75a');
  assert.deepEqual(r.items[0].qty, { status: 'not_given' });
  assert.equal(e.outcome, 'info_only');
  assert.equal(confirmed(e).length, 0);
});

test('ordered EN: read-back + yes + row → confirmed with qty, price range and catalogue stock', () => {
  const st = state(RETAIL, {
    intent: 'order', name: 'Chris',
    results: [{ action: 'create_service_request', status: 'succeeded', id: 'sr_9', requestType: 'order', value: { type: 'order', item: '2 x T-square', whenText: 'tomorrow 10am' } }],
  });
  const e = build(RETAIL, st, [t('agent', '2 T-squares for pickup tomorrow at 10. Shall I save it?'), t('caller', 'Yes please.')]);
  assert.equal(e.outcome, 'ordered');
  const [r] = e.receipts;
  assert.equal(r.status, 'confirmed');
  assert.deepEqual(r.items[0].qty, { value: 2, status: 'given' });
  assert.deepEqual(r.items[0].unitPrice, { min: 800, max: 1200, unit: 'each' });
  assert.equal(r.items[0].stock, 'in_stock');
});

test('booked EN and SW', () => {
  for (const [lang, turns] of [
    ['en', [t('agent', 'Deep clean, 1 bedroom on Saturday at 10 AM in Kilimani. Shall I book it?'), t('caller', 'Yes.')]],
    ['sw', [t('agent', 'Nikuwekee usafi wa nyumba Jumamosi saa nne asubuhi, Kilimani?'), t('caller', 'Ndio.')]],
  ]) {
    const st = state(HOME, {
      intent: 'booking', lang, name: 'Baraka',
      results: [{ action: 'create_appointment', status: 'succeeded', id: 'ap_1', appointmentStatus: 'requested', value: { serviceName: 'Deep clean, 1 bedroom', whenText: 'Saturday 10 AM' } }],
    });
    const e = build(HOME, st, turns);
    assert.equal(e.outcome, 'booked', lang);
    assert.equal(e.callLanguage, lang);
    assert.equal(e.receipts[0].status, 'confirmed');
    assert.equal(e.receipts[0].writtenRowId, 'ap_1');
    assert.equal(e.receipts[0].slots.service.value, 'Deep clean, 1 bedroom');
    assert.deepEqual(e.receipts[0].slots.name, { value: 'Baraka', status: 'given' });
  }
});

test('"Okay wait, let me check with my wife" at the read-back is not a yes', () => {
  const st = state(HOME, {
    intent: 'booking',
    results: [{ action: 'create_appointment', status: 'succeeded', id: 'ap_2', value: { serviceName: 'Deep clean, 1 bedroom', whenText: 'Sunday' } }],
  });
  const e = build(HOME, st, [t('agent', 'Deep clean on Sunday. Shall I book it?'), t('caller', 'Okay wait, let me check with my wife.')]);
  assert.equal(e.receipts[0].status, 'unconfirmed');
  assert.equal(e.outcome, 'info_only');
  for (const no of ['Ngoja kwanza', 'Sawa lakini kesho?', 'Hapana', 'Yes but make it three']) assert.equal(E.isExplicitYes(no), false, no);
  for (const yes of ['Yes.', 'Ndiyo', 'Sawa sawa', 'Yes please', 'Go ahead']) assert.equal(E.isExplicitYes(yes), true, yes);
});

const CALLBACK_ROW = { action: 'create_service_request', status: 'succeeded', id: 'sr_cb', requestType: 'callback', value: { type: 'callback', notes: 'Wants a quote for office cleaning' } };

test('callback confirmed EN and SW: number + time read back, explicit yes or the time repeated', () => {
  for (const [lang, turns] of [
    ['en', [t('caller', 'Please call me back.'), t('agent', 'The owner will call you on this number tomorrow at 3 pm. Is that right?'), t('caller', 'Yes.')]],
    ['sw', [t('caller', 'Nipigie baadaye.'), t('agent', 'Mwenye biashara atakupigia kwa namba hii kesho saa tisa, ni sawa?'), t('caller', 'Kesho saa tisa.')]],
  ]) {
    const st = state(HOME, { intent: 'human', lang, results: [CALLBACK_ROW] });
    const e = build(HOME, st, turns);
    assert.equal(e.outcome, 'callback_needed', lang);
    assert.equal(e.receipts[0].type, 'callback');
    assert.equal(e.receipts[0].status, 'confirmed', lang);
    assert.equal(e.urgent, false);
    assert.equal(e.callLanguage, lang);
  }
});

test('callback unconfirmed EN and SW: no read-back, no time, or "okay wait"', () => {
  for (const [lang, turns] of [
    ['en', [t('caller', 'Please call me back.'), t('agent', 'Okay, the owner will call you back.')]],
    ['en', [t('agent', 'The owner will call you back on this number. Is that okay?'), t('caller', 'Yes.')]],
    ['en', [t('agent', 'The owner will call you on this number tomorrow at 3 pm. Is that right?'), t('caller', 'Okay wait.')]],
    ['sw', [t('caller', 'Nipigie baadaye.'), t('agent', 'Sawa, mwenye biashara atakupigia.')]],
    ['sw', [t('agent', 'Mwenye biashara atakupigia kwa namba hii kesho saa tisa, ni sawa?'), t('caller', 'Ngoja kwanza.')]],
  ]) {
    const st = state(HOME, { intent: 'human', lang, results: [CALLBACK_ROW] });
    const e = build(HOME, st, turns);
    assert.equal(e.receipts[0].type, 'callback');
    assert.equal(e.receipts[0].status, 'unconfirmed', `${lang}: ${turns.map((x) => x.text).join(' / ')}`);
    assert.equal(e.outcome, 'callback_needed', 'still callback_needed, never urgent');
    assert.equal(e.urgent, false);
  }
});

test('escalated EN and SW: escalation receipt → urgent', () => {
  for (const lang of ['en', 'sw']) {
    const st = state(HOME, { intent: 'human', lang, results: [{ action: 'escalate', status: 'succeeded', channel: 'whatsapp' }] });
    const e = build(HOME, st, [t('caller', lang === 'sw' ? 'Nataka kuongea na manager sasa hivi.' : 'I need the manager now.')], { escalationReason: 'caller asked for the manager' });
    assert.equal(e.outcome, 'escalated');
    assert.equal(e.urgent, true);
    assert.equal(e.escalationReason, 'caller asked for the manager');
  }
});

test('abandoned EN and SW: answered, nothing captured, nothing answered', () => {
  for (const lang of ['en', 'sw']) {
    const st = state(HOME, { lang });
    const e = build(HOME, st, [t('caller', lang === 'sw' ? 'Habari' : 'Hello')]);
    assert.equal(e.outcome, 'abandoned');
    assert.equal(e.receipts.length, 0);
  }
});

test('info_only: a question answered, nothing captured', () => {
  const e = build(HOME, state(HOME, {}), [t('caller', 'What time do you open?')], { infoAnswered: true });
  assert.equal(e.outcome, 'info_only');
});

test('missed EN and SW: never answered, no receipts', () => {
  for (const lang of ['en', 'sw']) {
    const out = E.buildCallSummaryEvent({ path: 'v1', callLanguage: lang, callId: 'call_m', tenantId: 'ten_x', answered: false, caller: { phone: '+254700000002' }, receipts: [] });
    assert.equal(out.ok, true);
    assert.equal(out.event.outcome, 'missed');
    assert.equal(out.event.callLanguage, lang);
    assert.deepEqual(out.event.caller, { phone: '+254700000002' });
  }
});

test('validator rejects confirmed-without-row, urgent mismatch and invented stock', () => {
  const base = { event: E.EVENT_NAME, schemaVersion: 1, path: 'v1', callLanguage: 'en', callId: 'c', tenantId: 't', outcome: 'booked', urgent: false, caller: { phone: null }, emittedAt: new Date().toISOString() };
  assert.equal(E.validateCallSummaryEvent({ ...base, receipts: [{ receiptId: 'r1', type: 'booking', status: 'confirmed', slots: {} }] }).ok, false);
  assert.equal(E.validateCallSummaryEvent({ ...base, urgent: true, receipts: [] }).ok, false);
  assert.equal(E.validateCallSummaryEvent({ ...base, outcome: 'info_only', receipts: [{ receiptId: 'r1', type: 'order', status: 'unconfirmed', slots: {}, items: [{ catalogueId: 'name:mystery-pen', name: 'Mystery pen', qty: { status: 'not_given' }, stock: 'unconfirmed' }] }] }).ok, false, 'no synthetic catalogue ids');
  assert.equal(E.validateCallSummaryEvent({ ...base, outcome: 'missed', receipts: [] }).ok, true);
});

test('catalogueId is the real id or null: a catalogue row with no id keeps its price and stock', () => {
  const profile = { productCatalog: [{ name: 'Diary', price: '350', in_stock: 'yes' }] };
  const it = E.itemFromCatalogue(profile, { id: 'prd_0', name: 'Diary', qty: 2 });
  assert.equal(it.catalogueId, null);
  assert.deepEqual(it.unitPrice, { min: 350, max: 350, unit: 'each' });
  assert.equal(it.stock, 'in_stock');
});

test('off-catalogue item: no catalogueId, no price, stock unconfirmed', () => {
  const it = E.itemFromCatalogue(RETAIL, { name: 'Compass set', qty: 1 });
  assert.equal(it.catalogueId, null);
  assert.equal(it.stock, 'unconfirmed');
  assert.equal(it.unitPrice, undefined);
});

test('emitter: stores on the call row, hooks see replaces on a re-emit', async () => {
  E._resetForTests();
  const stored = [];
  const db = { mergeCallSummaryMeta: async (a) => { stored.push(a); } };
  const seen = [];
  E.onCallSummaryReady((ev, meta) => seen.push(meta.replaces));
  const { event } = E.buildCallSummaryEvent({ path: 'v1', callLanguage: 'en', callId: 'call_r', tenantId: 't', answered: true, caller: { phone: '+254700000003' }, receipts: [] });
  const quiet = { log() {}, warn() {} };
  await E.emitCallSummaryEvent(event, { db, callSid: 'sid_r', log: quiet });
  await E.emitCallSummaryEvent(event, { db, callSid: 'sid_r', log: quiet });
  assert.deepEqual(seen, [false, true]);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].patch.call_summary_event.callId, 'call_r');
  E._resetForTests();
});

test('flag is off by default', () => {
  assert.equal(E.callSummaryEventEnabled({}), false);
  assert.equal(E.callSummaryEventEnabled({ CALL_SUMMARY_EVENT: 'off' }), false);
  assert.equal(E.callSummaryEventEnabled({ CALL_SUMMARY_EVENT: 'on' }), true);
});

test('caller is { name?, phone } only; phone normalised to E.164, never guessed', () => {
  assert.equal(E.toE164('0712345678'), '+254712345678');
  assert.equal(E.toE164('254712345678'), '+254712345678');
  assert.equal(E.toE164('+447700900123'), '+447700900123');
  assert.equal(E.toE164('anonymous'), null);
  const out = E.buildCallSummaryEvent({ path: 'v1', callLanguage: 'en', callId: 'c', tenantId: 't', answered: false, caller: { phone: '0712345678', name: 'Baraka' }, receipts: [] });
  assert.deepEqual(out.event.caller, { name: 'Baraka', phone: '+254712345678' });
  const base = { event: E.EVENT_NAME, schemaVersion: 1, path: 'v1', callLanguage: 'en', callId: 'c', tenantId: 't', outcome: 'missed', urgent: false, receipts: [], emittedAt: new Date().toISOString() };
  assert.equal(E.validateCallSummaryEvent({ ...base, caller: { phone: '+254712345678', number: '+254712345678' } }).ok, false);
  assert.equal(E.validateCallSummaryEvent({ ...base, caller: { phone: '0712345678' } }).ok, false);
});

test('caller.phone from the shaped call row: from_number (db.getCall), else caller_number, else brain state, else null', () => {
  // db.getCall → shapeCall exposes calls.caller_number as from_number.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/db.js'), 'utf8');
  assert.match(src, /from_number: row\.caller_number/);
  assert.equal(E.callerPhoneFrom({ id: 'c1', tenant_id: 't1', call_sid: 'sid', from_number: '0712345678' }, null), '+254712345678');
  assert.equal(E.callerPhoneFrom({ caller_number: '254712345678' }, null), '+254712345678');
  assert.equal(E.callerPhoneFrom({ id: 'c1' }, { caller: { phone: '+254711000111' } }), '+254711000111');
  assert.equal(E.callerPhoneFrom({ id: 'c1', tenant_id: 't1' }, { caller: { phone: null } }), null);
  assert.equal(E.callerPhoneFrom(null, null), null);
  const out = E.buildCallSummaryEvent({ path: 'v1', callLanguage: 'en', callId: 'c1', tenantId: 't1', answered: true, caller: { phone: E.callerPhoneFrom({ from_number: '0712345678' }, null) }, receipts: [] });
  assert.equal(out.event.caller.phone, '+254712345678');
  const none = E.buildCallSummaryEvent({ path: 'v1', callLanguage: 'en', callId: 'c1', tenantId: 't1', answered: true, caller: { phone: E.callerPhoneFrom({ id: 'c1' }, null) }, receipts: [] });
  assert.equal(none.ok, true);
  assert.equal(none.event.caller.phone, null);
});
