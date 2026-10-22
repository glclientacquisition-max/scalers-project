'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FLAG,
  REJECT_XML,
  numberHoldClipEnabled,
  isProtectedNumber,
  numberForms,
  poolRowOnHold,
  numberHoldStatus,
  unownedNumberResponse,
} = require('../src/sautikit/numberHold');

const NOW = Date.parse('2026-10-22T20:00:00Z');
const FUTURE = '2026-11-05T20:00:00Z';
const PAST = '2026-10-20T20:00:00Z';
const HELD = '+254709221999';
const CLIP_XML = '<?xml version="1.0" encoding="UTF-8"?><Response><Play>en</Play><Play>sw</Play><Hangup/></Response>';

function fakeClient(result, calls = []) {
  return {
    from(table) {
      calls.push({ table });
      return {
        select(cols) {
          calls.push({ cols });
          return {
            in(col, vals) {
              calls.push({ col, vals });
              return typeof result === 'function' ? result(vals) : Promise.resolve(result);
            },
          };
        },
      };
    },
  };
}

const heldRow = (over = {}) => ({ e164: HELD, status: 'quarantine', winback_hold: true, quarantine_until: FUTURE, last_tenant_id: 't-old', ...over });
const on = { [FLAG]: 'on' };

describe('flag', () => {
  it('only the exact value on enables it', () => {
    assert.equal(numberHoldClipEnabled({}), false);
    for (const v of ['', 'true', '1', 'ON', ' on', 'yes']) assert.equal(numberHoldClipEnabled({ [FLAG]: v }), false, v);
    assert.equal(numberHoldClipEnabled(on), true);
  });

  it('off: returns <Reject/> without reading the pool or clips', async () => {
    const calls = [];
    let clips = 0;
    const r = await unownedNumberResponse(HELD, { env: {}, client: fakeClient({ data: [heldRow()] }, calls), lineUnavailable: async () => { clips++; return CLIP_XML; } });
    assert.equal(r.xml, REJECT_XML);
    assert.equal(r.held, false);
    assert.equal(calls.length, 0);
    assert.equal(clips, 0);
  });
});

describe('pool row rules (Desk #885 fields)', () => {
  it('held only when quarantine + winback_hold + quarantine_until in the future', () => {
    assert.equal(poolRowOnHold(heldRow(), NOW), true);
    assert.equal(poolRowOnHold(heldRow({ winback_hold: false }), NOW), false);
    assert.equal(poolRowOnHold(heldRow({ winback_hold: undefined }), NOW), false);
    assert.equal(poolRowOnHold(heldRow({ status: 'available' }), NOW), false);
    assert.equal(poolRowOnHold(heldRow({ status: 'assigned' }), NOW), false);
    assert.equal(poolRowOnHold(heldRow({ quarantine_until: PAST }), NOW), false);
    assert.equal(poolRowOnHold(heldRow({ quarantine_until: null }), NOW), false);
  });

  it('matches +254 / 254 / 0 forms', () => {
    assert.deepEqual(numberForms('0709221999').slice(0, 3), ['+254709221999', '254709221999', '0709221999']);
    assert.deepEqual(numberForms(''), []);
  });
});

describe('numberHoldStatus', () => {
  it('reads sautikit_did_pool with the #885 columns', async () => {
    const calls = [];
    const r = await numberHoldStatus(HELD, { client: fakeClient({ data: [heldRow()], error: null }, calls), now: () => NOW });
    assert.equal(r.held, true);
    assert.equal(r.until, FUTURE);
    assert.equal(calls[0].table, 'sautikit_did_pool');
    assert.match(calls[1].cols, /winback_hold/);
    assert.match(calls[1].cols, /quarantine_until/);
    assert.ok(calls[2].vals.includes('+254709221999'));
  });

  it('missing column (SQL not applied) is not held', async () => {
    const r = await numberHoldStatus(HELD, { client: fakeClient({ data: null, error: { message: 'column sautikit_did_pool.winback_hold does not exist' } }), now: () => NOW });
    assert.deepEqual(r, { held: false, reason: 'columns_missing' });
  });

  it('read error, throw and timeout are not held', async () => {
    assert.equal((await numberHoldStatus(HELD, { client: fakeClient({ data: null, error: { message: 'boom' } }) })).reason, 'lookup_failed');
    assert.equal((await numberHoldStatus(HELD, { client: { from() { throw new Error('x'); } } })).reason, 'lookup_failed');
    const slow = fakeClient(() => new Promise(() => {}));
    assert.equal((await numberHoldStatus(HELD, { client: slow, timeoutMs: 20 })).reason, 'timeout');
  });

  it('not in pool / expired hold / plain quarantine are not held', async () => {
    assert.equal((await numberHoldStatus(HELD, { client: fakeClient({ data: [] }), now: () => NOW })).reason, 'not_in_pool');
    assert.equal((await numberHoldStatus(HELD, { client: fakeClient({ data: [heldRow({ quarantine_until: PAST })] }), now: () => NOW })).reason, 'not_held');
    assert.equal((await numberHoldStatus(HELD, { client: fakeClient({ data: [heldRow({ winback_hold: false })] }), now: () => NOW })).reason, 'not_held');
  });

  it('+254709221536 is never treated as held, in any form, and the pool is not read', async () => {
    for (const n of ['+254709221536', '254709221536', '0709221536']) {
      assert.equal(isProtectedNumber(n), true);
      const calls = [];
      const r = await numberHoldStatus(n, { client: fakeClient({ data: [heldRow({ e164: '+254709221536' })] }, calls), now: () => NOW });
      assert.deepEqual(r, { held: false, reason: 'protected' });
      assert.equal(calls.length, 0);
    }
    assert.equal(isProtectedNumber('+254709221537'), false);
  });
});

describe('unownedNumberResponse (flag on)', () => {
  it('held: plays the existing line-unavailable XML', async () => {
    const r = await unownedNumberResponse(HELD, { env: on, client: fakeClient({ data: [heldRow()] }), now: () => NOW, lineUnavailable: async () => CLIP_XML });
    assert.equal(r.held, true);
    assert.equal(r.xml, CLIP_XML);
  });

  it('held with the real lineUnavailableResponse: EN + SW then hang up (Say fallback with no clips)', async () => {
    const { lineUnavailableResponse, LINE_UNAVAILABLE_EN, LINE_UNAVAILABLE_SW } = require('../src/sautikit/inactiveTenantGate');
    const r = await unownedNumberResponse(HELD, {
      env: on, client: fakeClient({ data: [heldRow()] }), now: () => NOW,
      lineUnavailable: () => lineUnavailableResponse({ loadClipUrls: async () => ({}), log: () => {} }),
    });
    assert.ok(r.xml.includes(LINE_UNAVAILABLE_EN));
    assert.ok(r.xml.includes(LINE_UNAVAILABLE_SW));
    assert.match(r.xml, /<Hangup\/><\/Response>$/);
    assert.doesNotMatch(r.xml, /<Stream|<Reject/);
  });

  it('not held, protected, missing columns or a clip failure: <Reject/> as today', async () => {
    const clip = async () => CLIP_XML;
    assert.equal((await unownedNumberResponse(HELD, { env: on, client: fakeClient({ data: [] }), lineUnavailable: clip })).xml, REJECT_XML);
    assert.equal((await unownedNumberResponse('+254709221536', { env: on, client: fakeClient({ data: [heldRow()] }), lineUnavailable: clip })).xml, REJECT_XML);
    assert.equal((await unownedNumberResponse(HELD, { env: on, client: fakeClient({ error: { message: 'schema cache: column winback_hold' } }), lineUnavailable: clip })).xml, REJECT_XML);
    assert.equal((await unownedNumberResponse(HELD, { env: on, client: fakeClient({ data: [heldRow()] }), now: () => NOW, lineUnavailable: async () => { throw new Error('x'); } })).xml, REJECT_XML);
  });
});

describe('server wiring', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it('only the two unassigned branches call it, before upsertCall and Stream', () => {
    const uses = server.split('unownedNumberResponse(toNumber').length - 1;
    assert.equal(uses, 2);
    const dirAt = server.indexOf('if (directoryHit.unassigned) {');
    const dirUse = server.indexOf('unownedNumberResponse(toNumber', dirAt);
    const rowAt = server.indexOf('const rowPromise = db', dirAt);
    assert.ok(dirAt > 0 && dirUse > dirAt && dirUse < rowAt, 'fast path: decided before the call row');
    const legacyAt = server.indexOf("if (dbErr?.code === 'unassigned_did') {");
    const legacyUse = server.indexOf('unownedNumberResponse(toNumber', legacyAt);
    const streamAt = server.indexOf('const twiml = buildAnswerStreamXml(');
    assert.ok(legacyAt > 0 && legacyUse > legacyAt && legacyUse < streamAt, 'legacy path: upsertCall threw unassigned_did, no row');
  });

  it('owned numbers never reach it: the closed-line gate and owners run first', () => {
    const closedGate = server.indexOf('if (line && line.closed === true) {');
    assert.ok(closedGate > 0 && closedGate < server.indexOf('unownedNumberResponse(toNumber'));
  });

  it('held calls are remembered so later lifecycle webhooks are ignored', () => {
    assert.match(server, /win-back hold until \$\{unowned\.until\}[\s\S]{0,140}closedLineCalls\.remember\(sid, callSid, extracted\.callSid\)/);
  });
});
