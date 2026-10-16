'use strict';
// OLD_PATH_ORDER_GUARD (default off): old-path orders/holds need catalogue items, a stock
// answer and a read-back with an explicit yes (or a repeat of the read-back). Synthetic data.
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/conversation/oldPathOrderGuard');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { formatToolConfirmation } = require('../src/conversation/toolExecution');

const CATALOG = [
  { name: 'Oxford Metallic Set', category: 'Geometry sets', price: '450', in_stock: 'yes' },
  { name: '3 Piece French Curve Set', category: 'Drawing', price: '300', in_stock: 'yes' },
  { name: 'A4 Paper Ream', price: '650', in_stock: 'unknown' },
  { name: 'HP Printer', price: '25000', in_stock: 'no' },
];
const PROFILE = { productCatalog: CATALOG };
const withFlag = async (v, fn) => { const p = process.env.OLD_PATH_ORDER_GUARD; if (v == null) delete process.env.OLD_PATH_ORDER_GUARD; else process.env.OLD_PATH_ORDER_GUARD = v; try { return await fn(); } finally { if (p == null) delete process.env.OLD_PATH_ORDER_GUARD; else process.env.OLD_PATH_ORDER_GUARD = p; } };
const order = (item, extra = {}) => ({ serviceRequest: { type: 'order', name: 'Brian', item, quantity: '', whenText: '', notes: '', ...extra } });
// drive the brain state the way server.js does: observeCallerTurn({ text, lastAgentText }) per caller turn
function call(turns) {
  let s = createBrainState(PROFILE);
  for (const [agent, caller] of turns) s = observeCallerTurn(s, { text: caller, lastAgentText: agent, profile: PROFILE });
  return s;
}

test('flag off: no state, no change, nothing blocked (identical behaviour)', async () => {
  await withFlag(null, () => {
    assert.equal(G.orderGuardEnabled(), false);
    const s = call([['Am I speaking with Brian?', 'Yes, yes.']]);
    assert.equal(s.orderGuard, undefined);
    const p = order('Big engineering drawing set');
    assert.equal(G.applyOrderGuard(p, s, PROFILE), null);
    assert.ok(p.serviceRequest, 'request untouched');
  });
});

test("HD_2847 shape: bare 'Yes, yes.' to an identity question never saves an order", async () => {
  await withFlag('on', () => {
    const s = call([
      ['We have sets like the Oxford metallic set and 3 piece french curve set. Which exact set would you like to order?', 'I wanted to order a set,'],
      ['Am I speaking with Brian?', 'Do you have the engineering set?'],
      ['Am I speaking with Brian?', 'Yes, yes.'],
    ]);
    const p = order('Big engineering drawing set');
    const r = G.applyOrderGuard(p, s, PROFILE);
    assert.ok(r && r.status === 'blocked' && r.code === 'order_guard');
    assert.equal(p.serviceRequest, undefined, 'nothing to write');
    assert.ok(r.missing.includes('catalog_item') && r.missing.includes('readback_yes'));
    assert.match(r.askLine, /couldn't find Big engineering drawing set on our list/);
    assert.equal(formatToolConfirmation([r], 'en'), r.askLine);
  });
});

test('known item but no read-back: re-asks the read-back once (with the stock answer), then stays blocked', async () => {
  await withFlag('on', () => {
    const s = call([['Which exact set would you like to order?', 'The Oxford metallic set please.']]);
    const r1 = G.applyOrderGuard(order('Oxford Metallic Set', { quantity: '2', whenText: 'tomorrow' }), s, PROFILE);
    assert.deepEqual(r1.missing, ['availability', 'readback_yes']);
    assert.equal(r1.askLine, 'Oxford Metallic Set is in stock. Just to confirm: 2 Oxford Metallic Set, tomorrow. Shall I place the order?');
    assert.equal(r1.reasked, true);
    const r2 = G.applyOrderGuard(order('Oxford Metallic Set', { quantity: '2', whenText: 'tomorrow' }), s, PROFILE);
    assert.equal(r2.reasked, false);
    assert.equal(r2.askLine, "I haven't placed the order yet.");
  });
});

test('read-back (with stock) + explicit yes saves; bare okay/sawa does not', async () => {
  await withFlag('on', () => {
    const rb = 'Oxford Metallic Set is in stock. Just to confirm: 2 Oxford Metallic Set, tomorrow. Shall I place the order?';
    for (const yes of ['Yes, yes.', 'Yes please.', 'Ndio.', 'Sure, go ahead.', 'Correct.']) {
      const p = order('Oxford Metallic Set', { quantity: '2' });
      assert.equal(G.applyOrderGuard(p, call([[rb, yes]]), PROFILE), null, yes);
      assert.ok(p.serviceRequest, yes);
    }
    for (const no of ['Okay.', 'Sawa.', 'Alright.', 'No, wait.', 'Yes but change it to three.']) {
      const p = order('Oxford Metallic Set', { quantity: '2' });
      assert.ok(G.applyOrderGuard(p, call([[rb, no]]), PROFILE), no);
      assert.equal(p.serviceRequest, undefined, no);
    }
  });
});

test('repeating the read-back counts as yes (EN and SW)', async () => {
  await withFlag('on', () => {
    const rb = 'Oxford Metallic Set is in stock. Just to confirm: 2 Oxford Metallic Set. Shall I place the order?';
    assert.equal(G.applyOrderGuard(order('Oxford Metallic Set', { quantity: '2' }), call([[rb, 'Two Oxford metallic set, 2.']]), PROFILE), null);
    const sw = 'Oxford Metallic Set inapatikana. Nithibitishe: 2 Oxford Metallic Set. Niweke oda?';
    assert.equal(G.applyOrderGuard(order('Oxford Metallic Set', { quantity: '2' }), call([[sw, 'Oxford metallic set 2.']]), PROFILE), null);
    // a repeat with a different quantity is a change, not a yes
    assert.ok(G.applyOrderGuard(order('Oxford Metallic Set', { quantity: '2' }), call([[rb, 'Oxford metallic set 3.']]), PROFILE));
  });
});

test('every item must match; multi-item read-back names each item', async () => {
  await withFlag('on', () => {
    const rb = 'Both are in stock: Oxford Metallic Set and 3 Piece French Curve Set. Shall I place the order?';
    assert.equal(G.applyOrderGuard(order('Oxford Metallic Set and 3 Piece French Curve Set'), call([[rb, 'Yes.']]), PROFILE), null);
    const r = G.applyOrderGuard(order('Oxford Metallic Set, engineering drawing set'), call([[rb, 'Yes.']]), PROFILE);
    assert.ok(r.missing.includes('catalog_item'));
  });
});

test('stock: out of stock blocks with a plain answer; unknown stock is stated in the read-back', async () => {
  await withFlag('on', () => {
    const r = G.applyOrderGuard(order('HP Printer'), call([['HP Printer is available. Shall I place the order for HP Printer?', 'Yes.']]), PROFILE);
    assert.ok(r.missing.includes('out_of_stock'));
    assert.match(r.askLine, /HP Printer is out of stock/);
    const u = G.applyOrderGuard(order('A4 Paper Ream'), call([['Which item?', 'A4 paper ream.']]), PROFILE);
    assert.match(u.askLine, /can't confirm stock for A4 Paper Ream.*Just to confirm: A4 Paper Ream\. Shall I place the order\?/);
  });
});

test('Swahili re-ask lines', async () => {
  await withFlag('on', () => {
    const s = call([['Ungependa kitu gani?', 'Nataka Oxford metallic set.']]);
    s.language = { current: 'sw' };
    const r = G.applyOrderGuard(order('Oxford Metallic Set'), s, PROFILE);
    assert.equal(r.askLine, 'Oxford Metallic Set inapatikana. Nithibitishe: Oxford Metallic Set. Niweke oda?');
    const s2 = call([['Am I speaking with Brian?', 'Ndio, ndio.']]); s2.language = { current: 'sw' };
    assert.match(G.applyOrderGuard(order('Big engineering drawing set'), s2, PROFILE).askLine, /^Sijapata Big engineering drawing set kwenye orodha yetu/);
  });
});

test('not an order or hold (enquiry, callback, complaint): never guarded', async () => {
  await withFlag('on', () => {
    for (const type of ['enquiry', 'callback', 'complaint', 'quote']) {
      const p = { serviceRequest: { type, item: 'Big engineering drawing set', notes: 'call me' } };
      assert.equal(G.applyOrderGuard(p, call([['Anything else?', 'Yes, yes.']]), PROFILE), null, type);
      assert.ok(p.serviceRequest);
    }
  });
});
