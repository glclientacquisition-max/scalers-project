'use strict';
// OLD_PATH_ORDER_GUARD replay of the three prod Aris saves of 17-20 Oct 2026 (fixture:
// tests/fixtures/order-guard/prod-saves-2026-10.json). Each call wrote one service_requests row
// with no read-back and no explicit yes. Asserts what the guard does today, per call:
// - HD_e75a669780d4 (type order): BLOCKED, missing readback_yes; nothing written; read-back asked.
// - HD_c427511e5773, HD_6862135bc8af (type enquiry): NOT guarded. GUARDED_TYPES is order/hold only,
//   so these two writes still go through with the flag on. Recorded here so the gap is explicit.
//
// Brain's rule (21 Oct): any save carrying items, quantities, a price or a time needs a read-back
// and an explicit yes, even typed enquiry; a pure callback or question does not. The guard is NOT
// widened yet (Brain's C2 matcher fix lands first). Until then:
// - PENDING (todo): the two enquiry saves should be blocked. They fail today and are reported as
//   todo, so test:brain stays green; they point at the wider guard.
// - MATCHER (todo + pin): "Protractor" and "PVC detachable T-square" are in the catalogue but
//   today's findProductMatch returns null. The todo tests assert the fixed behaviour; the pin
//   tests assert today's miss and FAIL once C2 lands, so the todo marks get removed with it.
const test = require('node:test');
const assert = require('node:assert');
const F = require('./fixtures/order-guard/prod-saves-2026-10.json');
const G = require('../src/conversation/oldPathOrderGuard');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { formatToolConfirmation } = require('../src/conversation/toolExecution');

const PROFILE = { productCatalog: F.catalog };
const byCall = Object.fromEntries(F.calls.map((c) => [c.call, c]));

async function withFlag(v, fn) {
  const p = process.env.OLD_PATH_ORDER_GUARD;
  if (v == null) delete process.env.OLD_PATH_ORDER_GUARD;
  else process.env.OLD_PATH_ORDER_GUARD = v;
  try {
    return await fn();
  } finally {
    if (p == null) delete process.env.OLD_PATH_ORDER_GUARD;
    else process.env.OLD_PATH_ORDER_GUARD = p;
  }
}

function replay(c) {
  let s = createBrainState(PROFILE);
  for (const [agent, caller] of c.turns) s = observeCallerTurn(s, { text: caller, lastAgentText: agent, profile: PROFILE });
  const parsed = { serviceRequest: { name: '', notes: '', quantity: '', whenText: '', ...c.written } };
  const block = G.applyOrderGuard(parsed, s, PROFILE);
  return { parsed, block };
}

test('flag off: all three prod saves go through unchanged', async () => {
  await withFlag(null, () => {
    for (const c of F.calls) {
      const { parsed, block } = replay(c);
      assert.equal(block, null, c.call);
      assert.ok(parsed.serviceRequest, `${c.call} request untouched`);
    }
  });
});

test('flag on: HD_e75a669780d4 ORDER is blocked (no read-back yes); nothing written; read-back asked', async () => {
  await withFlag('on', () => {
    const { parsed, block } = replay(byCall.HD_e75a669780d4);
    assert.ok(block, 'blocked');
    assert.equal(block.status, 'blocked');
    assert.equal(block.code, 'order_guard');
    assert.ok(block.missing.includes('readback_yes'));
    assert.equal(parsed.serviceRequest, undefined, 'serviceRequest removed: no row, no ORDER SMS, no caller_order SMS');
    assert.match(block.askLine, /Mg zipper bag-a4/);
    assert.match(block.askLine, /\?$/);
    assert.equal(formatToolConfirmation([block], 'en'), block.askLine);
  });
});

test('EXPECTED GAP (today), flag on: the two prod ENQUIRY saves are NOT guarded (type enquiry is outside GUARDED_TYPES); see PENDING below', async () => {
  await withFlag('on', () => {
    for (const id of ['HD_c427511e5773', 'HD_6862135bc8af']) {
      const { parsed, block } = replay(byCall[id]);
      assert.equal(block, null, `${id}: guard does not run for enquiry`);
      assert.equal(parsed.serviceRequest.type, 'enquiry');
    }
  });
});

test('flag on: had those two been typed order, the guard would block them (catalog miss + no read-back yes)', async () => {
  await withFlag('on', () => {
    for (const id of ['HD_c427511e5773', 'HD_6862135bc8af']) {
      const c = byCall[id];
      const { parsed, block } = replay({ ...c, written: { ...c.written, type: 'order' } });
      assert.ok(block, id);
      assert.ok(block.missing.includes('readback_yes'), id);
      // Known false negative shared with findProductMatch (brain-gaps 2026-10-21 section 2):
      // "PVC detachable T-square" and bare "Protractor" do not match the stored rows.
      assert.ok(block.missing.includes('catalog_item'), id);
      assert.equal(parsed.serviceRequest, undefined, id);
    }
  });
});

// ---------- Brain rule 21 Oct: negative cases, pending the wider guard and the C2 matcher fix ----------

const { findProductMatch } = require('../src/conversation/productCatalog');
const PROTRACTOR_ROWS = F.catalog.filter((p) => /protractor/i.test(p.name)).map((p) => p.name);
const TSQUARE_ROW = 'Pvc detachable t square';
const C2 = "pending Brain C2 matcher fix (brain-gaps 2026-10-21 section 2)";
const WIDER = 'pending wider OLD_PATH_ORDER_GUARD: enquiry saves with items/quantity/price/time need read-back + yes (Brain rule 21 Oct; after C2)';

test('fixture: two protractor rows and one T-square row are on file', () => {
  assert.equal(PROTRACTOR_ROWS.length, 2);
  assert.ok(F.catalog.some((p) => p.name === TSQUARE_ROW));
});

test('MATCHER pin (today): "Protractor" is misflagged as not in the catalogue. Fails when C2 lands: delete this pin and the todo mark below', () => {
  assert.equal(findProductMatch('Protractor', F.catalog), null);
  const d = G.evaluateOrder({ request: { type: 'order', item: 'Protractor' }, productCatalog: F.catalog });
  assert.ok(d.missing.includes('catalog_item'));
  assert.deepEqual(d.unmatched, ['Protractor']);
});

test('MATCHER pin (today): "PVC detachable T-square" is misflagged as not in the catalogue. Fails when C2 lands: delete this pin and the todo mark below', () => {
  assert.equal(findProductMatch('PVC detachable T-square', F.catalog), null);
  const d = G.evaluateOrder({ request: { type: 'order', item: 'PVC detachable T-square' }, productCatalog: F.catalog });
  assert.ok(d.missing.includes('catalog_item'));
  assert.deepEqual(d.unmatched, ['PVC detachable T-square']);
});

test('MATCHER: "Protractor" resolves to one of the 2 protractor rows, not "not in catalogue"', { todo: C2 }, () => {
  const m = findProductMatch('Protractor', F.catalog);
  assert.ok(m, 'matched');
  assert.ok(PROTRACTOR_ROWS.includes(m.product.name), m && m.product.name);
  const d = G.evaluateOrder({ request: { type: 'order', item: 'Protractor' }, productCatalog: F.catalog });
  assert.ok(!d.missing.includes('catalog_item'), 'not flagged as missing from the catalogue');
});

test('MATCHER: "PVC detachable T-square" resolves to the stored "Pvc detachable t square" row', { todo: C2 }, () => {
  const m = findProductMatch('PVC detachable T-square', F.catalog);
  assert.ok(m, 'matched');
  assert.equal(m.product.name, TSQUARE_ROW);
  const d = G.evaluateOrder({ request: { type: 'order', item: 'PVC detachable T-square' }, productCatalog: F.catalog });
  assert.ok(!d.missing.includes('catalog_item'), 'not flagged as missing from the catalogue');
});

for (const id of ['HD_c427511e5773', 'HD_6862135bc8af']) {
  test(`PENDING ${id}: enquiry save with items/quantity/time and no read-back is blocked, read-back asked`, { todo: WIDER }, async () => {
    await withFlag('on', () => {
      const c = byCall[id];
      assert.equal(c.written.type, 'enquiry');
      assert.ok(c.written.item && (c.written.quantity || c.written.whenText), 'carries an item plus a quantity or time');
      const { parsed, block } = replay(c);
      assert.ok(block, `${id} blocked`);
      assert.ok(block.missing.includes('readback_yes'), id);
      assert.equal(parsed.serviceRequest, undefined, `${id}: no row written`);
      assert.match(block.askLine, /\?$/);
    });
  });
}

test('pure callback / question enquiry (no items, quantity, price or time) is never blocked, flag on (must stay true after widening)', async () => {
  await withFlag('on', () => {
    for (const written of [
      { type: 'enquiry', item: '', notes: 'Caller asked for a callback about opening hours.' },
      { type: 'callback', item: '', notes: 'Please call back.' },
    ]) {
      const { parsed, block } = replay({ call: 'synthetic', written, turns: [['', 'Can someone call me back?']] });
      assert.equal(block, null, written.type);
      assert.ok(parsed.serviceRequest, `${written.type}: written`);
    }
  });
});
