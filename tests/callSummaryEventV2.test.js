// Run: node --test tests/callSummaryEventV2.test.js
// A4: `call.summary.ready` from BA v2 finishCall (machine state + commit receipts).
const test = require('node:test');
const assert = require('node:assert/strict');

const V2 = require('../src/conversation/v2');
const { finishCall } = require('../src/conversation/v2/machine');
const E = require('../src/conversation/callSummaryEvent');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const RS = JSON.parse(JSON.stringify(require('../evals/v2/fixtures/tenants/retail_shop.json')));
RS.productCatalog.push({ id: 'prd_protractor', name: 'Protractor', aliases: ['protractors'], price: '50', in_stock: null });
const NOW = new Date('2026-10-14T05:00:00Z');

function handlers({ failWrites = false } = {}) {
  const log = [];
  return { log, handlers: {
    createAppointment: async (a) => (log.push(['appt', a]), failWrites ? { id: null, ok: false } : { id: 'apt_1' }),
    updateAppointment: async (u) => (log.push(['upd', u]), { id: u.appointmentId }),
    createServiceRequest: async (r) => (log.push(['sr', r]), failWrites ? { id: null, ok: false } : { id: 'sr_1' }),
    escalate: async (e) => (log.push(['esc', e]), { ok: true }),
    saveCallerInfo: async () => ({ ok: true }),
  } };
}
async function call(profile, lines, { langLock = null, failWrites = false } = {}) {
  const h = handlers({ failWrites });
  const st = V2.createState({ profile, callerPhone: '+254700000001' });
  for (const text of lines) await V2.runTurn(st, { text, profile, now: NOW, handlers: h.handlers, langLock });
  const fin = finishCall(st, { businessName: profile.businessName, callerPhone: '+254700000001', profile });
  const built = E.buildCallSummaryEvent({
    path: 'v2', callLanguage: st.lang, callId: 'call_v2', tenantId: 'ten_v2', answered: true,
    infoAnswered: fin.infoAnswered, caller: { phone: '+254700000001', name: st.slots.name }, receipts: fin.summaryReceipts,
  });
  assert.equal(built.ok, true, built.errors.join('; '));
  return { e: built.event, fin, log: h.log, st };
}
const confirmed = (e) => e.receipts.filter((r) => r.status === 'confirmed');

test('v2 HD_8a8aa14db292 synthetic: stock ask + order interest, no write → 0 confirmed, stock unconfirmed', async () => {
  const { e, log } = await call(RS, ['Do you have protractors in stock?', 'I want to order a protractor.']);
  assert.equal(log.filter((x) => x[0] === 'sr').length, 0);
  assert.equal(confirmed(e).length, 0);
  assert.equal(e.outcome, 'info_only');
  const order = e.receipts.find((r) => r.type === 'order');
  assert.equal(order.status, 'unconfirmed');
  assert.equal(order.items[0].stock, 'unconfirmed');
  assert.equal(order.writtenRowId, undefined);
  assert.equal(e.path, 'v2');
});

test('v2 HD_e75a669780d4 synthetic: order with no quantity and no read-back → unconfirmed, qty not_given', async () => {
  const { e } = await call(RS, ['I want to order protractors.']);
  const [r] = e.receipts;
  assert.equal(r.type, 'order');
  assert.equal(r.status, 'unconfirmed');
  assert.deepEqual(r.items[0].qty, { status: 'not_given' });
  assert.equal(confirmed(e).length, 0);
});

test('v2 ordered EN: read-back + yes + row → confirmed with catalogue price and stock', async () => {
  const { e } = await call(RS, ["I'd like to order 2 diaries, pick up tomorrow. I am Brian.", 'Yes.']);
  assert.equal(e.outcome, 'ordered');
  const [r] = e.receipts;
  assert.equal(r.status, 'confirmed');
  assert.equal(r.writtenRowId, 'sr_1');
  assert.deepEqual(r.items[0].qty, { value: 2, status: 'given' });
  assert.deepEqual(r.items[0].unitPrice, { min: 350, max: 350, unit: 'each' });
  assert.equal(r.items[0].stock, 'in_stock');
  assert.deepEqual(r.slots.name, { value: 'Brian', status: 'given' });
});

test('v2 booked EN and SW', async () => {
  const en = await call(DD, ['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Yes.']);
  assert.equal(en.e.outcome, 'booked'); assert.equal(en.e.callLanguage, 'en');
  assert.equal(en.e.receipts[0].writtenRowId, 'apt_1');
  assert.equal(en.e.receipts[0].slots.place.value, 'Kitengela');
  const sw = await call(DD, ['Nataka kubook carpet cleaning kesho saa tatu asubuhi, Ruiru. Naitwa Wanjiru.', 'Ndio.']);
  assert.equal(sw.e.outcome, 'booked'); assert.equal(sw.e.callLanguage, 'sw');
  assert.equal(sw.e.receipts[0].status, 'confirmed');
});

test('v2 read-back never answered → unconfirmed booking, not booked', async () => {
  const { e } = await call(DD, ['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.']);
  assert.equal(e.outcome, 'info_only');
  assert.equal(e.receipts[0].status, 'unconfirmed');
  assert.equal(e.receipts[0].type, 'booking');
});

test('v2 failed write after yes → unconfirmed, never "booked"', async () => {
  const { e, fin } = await call(DD, ['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Yes.'], { failWrites: true });
  assert.equal(fin.outcome, 'booked', 'legacy finishCall outcome is unchanged (known gap)');
  assert.equal(e.outcome, 'info_only');
  assert.equal(confirmed(e).length, 0);
});

test('v2 escalated EN and SW: caller asks for a person → escalation receipt, urgent', async () => {
  const en = await call(DD, ['I want to speak to the manager.', 'Yes.']);
  assert.equal(en.e.outcome, 'escalated'); assert.equal(en.e.urgent, true);
  assert.equal(en.e.escalationReason, 'Caller asked for a person');
  const sw = await call(DD, ['Nataka kuongea na manager.', 'Ndio.'], { langLock: 'sw' });
  assert.equal(sw.e.outcome, 'escalated'); assert.equal(sw.e.callLanguage, 'sw');
});

test('v2 callback_needed: a complaint is written for the owner to call back (not urgent)', async () => {
  const { e } = await call(DD, ['My sofa was damaged by your team.', 'They tore it.']);
  assert.equal(e.outcome, 'callback_needed');
  assert.equal(e.receipts[0].type, 'complaint');
  assert.equal(e.urgent, false);
});

test('v2 info_only and abandoned: hours answered vs bare hello', async () => {
  const info = await call(DD, ['What time do you open?']);
  assert.equal(info.e.outcome, 'info_only');
  const hello = await call(DD, ['Hello?']);
  assert.equal(hello.e.outcome, 'abandoned');
  assert.equal(hello.e.receipts.length, 0);
});

test('v2 finishCall keeps its legacy fields (ownerText, outcome)', async () => {
  const { fin } = await call(DD, ['What time do you open?']);
  assert.equal(typeof fin.ownerText, 'string');
  assert.equal(fin.outcome, 'answered');
});

test('v2 + v1 merge: same row once, v2 owns handoffs (no phantom urgent escalation)', () => {
  const v2 = [
    { receiptId: 'v2_1', type: 'order', status: 'confirmed', writtenRowId: 'sr_1', slots: {}, items: [] },
    { receiptId: 'v2_2', type: 'callback', status: 'confirmed', slots: {} },
  ];
  const v1 = [
    { receiptId: 'v1_1', type: 'order', status: 'unconfirmed', writtenRowId: 'sr_1', slots: {}, items: [] },
    { receiptId: 'v1_2', type: 'escalation', status: 'confirmed', slots: {} },
    { receiptId: 'v1_3', type: 'booking', status: 'unconfirmed', writtenRowId: 'apt_9', slots: {} },
  ];
  const merged = E.mergeV2Receipts(v2, v1);
  assert.deepEqual(merged.map((r) => [r.type, r.writtenRowId || null]), [['order', 'sr_1'], ['callback', null], ['booking', 'apt_9']]);
  const built = E.buildCallSummaryEvent({ path: 'v2', callLanguage: 'en', callId: 'c', tenantId: 't', answered: true, caller: { phone: '+254700000001' }, receipts: merged });
  assert.equal(built.ok, true, built.errors.join('; '));
  assert.equal(built.event.urgent, false);
  assert.equal(built.event.outcome, 'ordered');
});

test('v2 callback unconfirmed EN and SW: the handoff read-back gives no time, so a yes is not enough', async () => {
  for (const langLock of [null, 'sw']) {
    const { e } = await call(DD, ['I want to pay to a different M-Pesa number, can you change my payment details?', langLock ? 'Ndio.' : 'Yes.'], { langLock });
    const [r] = e.receipts;
    assert.equal(r.type, 'callback');
    assert.equal(r.status, 'unconfirmed', String(langLock));
    assert.equal(e.outcome, 'callback_needed');
    assert.equal(e.urgent, false);
  }
});

test('v2 callback confirmed EN and SW: number + time read back, yes or the time repeated, write ok', () => {
  const { receiptsFromV2 } = require('../src/conversation/v2/summaryReceipts');
  const mk = (readbackLine, replyText, ok = true) => ({
    v: 2, slots: { name: null, items: [], when: {} }, staffNames: [], pending: null, intent: null,
    receipts: [{ tool: 'create_handoff', kind: 'ladder', ok, id: null, readbackLine, replyText }],
  });
  const cases = [
    ['The team will call you on this number tomorrow at 3 pm. Is that okay?', 'Yes.', true, 'confirmed'],
    ['Timu itakupigia kwa namba hii kesho saa tisa, ni sawa?', 'Kesho saa tisa.', true, 'confirmed'],
    ['The team will call you on this number tomorrow at 3 pm. Is that okay?', 'Okay wait.', true, 'unconfirmed'],
    ['Timu itakupigia kwa namba hii kesho saa tisa, ni sawa?', 'Ndio.', false, 'unconfirmed'],
  ];
  for (const [line, reply, ok, want] of cases) {
    const [r] = receiptsFromV2(mk(line, reply, ok), DD);
    assert.equal(r.type, 'callback');
    assert.equal(r.status, want, `${line} / ${reply} / ok=${ok}`);
    const built = E.buildCallSummaryEvent({ path: 'v2', callLanguage: 'en', callId: 'c', tenantId: 't', answered: true, caller: { phone: null }, receipts: [r] });
    assert.equal(built.ok, true, built.errors.join('; '));
    assert.equal(built.event.outcome, 'callback_needed');
    assert.equal(built.event.urgent, false);
  }
});

test('v2 order items carry the real catalogue id or null (never prd_<n> or name:<slug>)', async () => {
  const { e } = await call(RS, ["I'd like to order 2 diaries, pick up tomorrow. I am Brian.", 'Yes.']);
  assert.equal(e.receipts[0].items[0].catalogueId, null, 'fixture Diary row has no id');
  const p = await call(RS, ['I want to order protractors.']);
  assert.equal(p.e.receipts[0].items[0].catalogueId, 'prd_protractor');
});
