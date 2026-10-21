'use strict';
// OLD_PATH_ORDER_GUARD replay of the three prod Aris saves of 17-20 Oct 2026 (fixture:
// tests/fixtures/order-guard/prod-saves-2026-10.json). Each call wrote one service_requests row
// with no read-back and no explicit yes. Asserts what the guard does today, per call:
// - HD_e75a669780d4 (type order): BLOCKED, missing readback_yes; nothing written; read-back asked.
// - HD_c427511e5773, HD_6862135bc8af (type enquiry): NOT guarded. GUARDED_TYPES is order/hold only,
//   so these two writes still go through with the flag on. Recorded here so the gap is explicit.
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

test('flag on: the two prod ENQUIRY saves are NOT guarded (type enquiry is outside GUARDED_TYPES)', async () => {
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
