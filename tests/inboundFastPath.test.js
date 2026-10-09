const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createInboundDirectory, fastInboundEnabled } = require('../src/sautikit/inboundDirectory');
const { createInboundCalls, completedIsCallSetup } = require('../src/sautikit/inboundCalls');
const { createRecordingFetchScheduler, RECORDING_FETCH_DELAYS_MS } = require('../src/sautikit/recordingSchedule');

const DID = '+254700000001';
const rowsFor = (over = {}) => [
  { id: 't1', sautikit_virtual_number: DID, is_active: true, minutes_included: 100, seconds_used: 60, on_demand_usage_enabled: false, ...over },
  { id: 't2', sautikit_virtual_number: '+254700000002', is_active: false },
];

function dirWith(rows, opts = {}) {
  let loads = 0;
  let t = 0;
  const dir = createInboundDirectory({
    loadTenants: async () => {
      loads += 1;
      return { rows: typeof rows === 'function' ? rows() : rows, packageColumns: true };
    },
    now: () => t,
    ttlMs: 30000,
    ...opts,
  });
  return { dir, loads: () => loads, tick: (ms) => (t += ms) };
}

describe('inbound directory (resolveTenantId parity, no reads on the hot path)', () => {
  it('cold start loads once; later lookups are memory only', async () => {
    const { dir, loads } = dirWith(rowsFor());
    const a = await dir.lookup({ fromNumber: '+254711111111', toNumber: DID });
    const b = await dir.lookup({ fromNumber: '+254722222222', toNumber: DID });
    assert.equal(loads(), 1);
    assert.equal(a.tenantId, 't1');
    assert.equal(b.tenantId, 't1');
    assert.equal(a.gate.open, true);
    assert.deepEqual(a.tenantDids, [DID]);
  });

  it('digit-normalised match on active rows (254 vs +254)', async () => {
    const { dir } = dirWith(rowsFor());
    const r = await dir.lookup({ fromNumber: '0711', toNumber: '254700000001' });
    assert.equal(r.tenantId, 't1');
  });

  it('exact DID still resolves an inactive row, like resolveTenantId', async () => {
    const { dir } = dirWith(rowsFor());
    const r = await dir.lookup({ toNumber: '+254700000002' });
    assert.equal(r.tenantId, 't2');
    assert.deepEqual(r.line, { active: false, archived: false });
  });

  it('unknown number re-reads once before rejecting', async () => {
    let rows = rowsFor();
    const { dir, loads } = dirWith(() => rows);
    await dir.refresh();
    rows = [...rowsFor(), { id: 't3', sautikit_virtual_number: '+254700000003', is_active: true }];
    const fresh = await dir.lookup({ toNumber: '+254700000003' });
    assert.equal(fresh.tenantId, 't3');
    assert.equal(fresh.refreshed, true);
    const none = await dir.lookup({ toNumber: '+254799999999' });
    assert.equal(none.unassigned, true);
    assert.equal(loads(), 3);
  });

  it('package exhausted closes the gate; on-demand keeps it open', async () => {
    const closed = await dirWith(rowsFor({ seconds_used: 6000 })).dir.lookup({ toNumber: DID });
    assert.equal(closed.gate.open, false);
    const od = await dirWith(rowsFor({ seconds_used: 6000, on_demand_usage_enabled: true })).dir.lookup({ toNumber: DID });
    assert.equal(od.gate.open, true);
  });

  it('stale snapshot answers at once and refreshes in the background', async () => {
    const { dir, loads, tick } = dirWith(rowsFor());
    await dir.refresh();
    tick(31000);
    const r = await dir.lookup({ toNumber: DID });
    assert.equal(r.tenantId, 't1');
    await new Promise((res) => setImmediate(res));
    assert.equal(loads(), 2);
  });

  it('TENANT_ID pins every call to that tenant', async () => {
    const { dir } = dirWith(rowsFor(), { defaultTenantId: 't1' });
    const r = await dir.lookup({ toNumber: '+254799999999' });
    assert.equal(r.tenantId, 't1');
    assert.equal(r.unassigned, false);
  });

  it('caller/callee flip uses the cached DIDs', async () => {
    const { dir } = dirWith(rowsFor());
    const flip = ({ fromNumber, toNumber, tenantDids }) =>
      tenantDids.includes(fromNumber)
        ? { fromNumber: toNumber, toNumber: fromNumber, swapped: true }
        : { fromNumber, toNumber, swapped: false };
    const r = await dir.lookup({ fromNumber: DID, toNumber: '+254711111111' }, flip);
    assert.equal(r.swapped, true);
    assert.equal(r.toNumber, DID);
    assert.equal(r.tenantId, 't1');
  });

  it('flag', () => {
    assert.equal(fastInboundEnabled({}), true);
    assert.equal(fastInboundEnabled({ VOICE_FAST_INBOUND: '0' }), false);
  });
});

describe('inbound call memory', () => {
  it('Completed with set-up fields is set-up only before Stream went out', () => {
    assert.equal(completedIsCallSetup({ state: 'Completed', hasCallSetupFields: true, streamIssued: false }), true);
    assert.equal(completedIsCallSetup({ state: 'Completed', hasCallSetupFields: true, streamIssued: true }), false);
    assert.equal(completedIsCallSetup({ state: 'Ringing', hasCallSetupFields: true }), false);
  });

  it('tracks Stream, the background row, and the tenant', async () => {
    const calls = createInboundCalls();
    assert.equal(calls.streamIssuedFor('HD_x'), false);
    calls.markStreamIssued('HD_x');
    assert.equal(calls.streamIssuedFor('HD_x'), true);
    let resolve;
    calls.trackRow('HD_x', new Promise((r) => (resolve = r)), 't1');
    assert.equal(calls.tenantIdFor('HD_x'), 't1');
    setTimeout(() => resolve({ id: 'row' }), 10);
    assert.deepEqual(await calls.awaitRow('HD_x', 500), { id: 'row' });
    assert.equal(await calls.awaitRow('missing'), null);
  });

  it('awaitRow is bounded and a failed write resolves null', async () => {
    const calls = createInboundCalls();
    calls.trackRow('slow', new Promise(() => {}), null);
    assert.equal(await calls.awaitRow('slow', 20), null);
    calls.trackRow('bad', Promise.reject(new Error('db down')), null);
    assert.equal(await calls.awaitRow('bad', 50), null);
  });
});

describe('recording fetch schedule', () => {
  it('retries on backoff until attached, once per sid', async () => {
    const timers = [];
    const seen = [];
    let attempts = 0;
    const s = createRecordingFetchScheduler({
      attach: async (ids, source) => {
        seen.push(source);
        attempts += 1;
        return attempts >= 2 ? ids[0] : null;
      },
      setTimer: (fn, ms) => timers.push({ fn, ms }),
    });
    assert.equal(s.schedule(['HD_a', 'prov_1'], 'voice/incoming'), true);
    assert.equal(s.schedule(['HD_a'], 'ws/media'), false, 'second source dedupes');
    await timers.shift().fn();
    await timers.shift().fn();
    assert.equal(timers.length, 0, 'stops after attach');
    assert.deepEqual(seen, ['voice/incoming+retry1', 'voice/incoming+retry2']);
    assert.deepEqual(RECORDING_FETCH_DELAYS_MS, [8000, 30000, 90000]);
  });

  it('gives up after the last delay', async () => {
    const timers = [];
    const logs = [];
    const s = createRecordingFetchScheduler({
      attach: async () => null,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      log: (m) => logs.push(m),
    });
    s.schedule(['HD_b'], 'ws/media');
    while (timers.length) await timers.shift().fn();
    assert.match(logs.join('\n'), /not available after 3 tries/);
  });
});

describe('server wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf('async function handleVoiceIncoming(');
  const handler = src.slice(start, src.indexOf('async function noteWhatsAppDeliveryFailed('));

  it('fast path: directory lookup, no awaited upsert before Stream', () => {
    assert.match(handler, /inboundDirectory\.lookup\(/);
    const fastAt = handler.indexOf('if (directoryHit) {\n      if (directoryHit.gate');
    const legacyAt = handler.indexOf('} else {\n      try {\n        const gate = await db.packageInboundOpen');
    assert.ok(fastAt > 0 && legacyAt > fastAt);
    const fast = handler.slice(fastAt, legacyAt);
    assert.doesNotMatch(fast, /await db\./);
    assert.match(fast, /inboundCalls\.trackRow\(callSid, rowPromise/);
    assert.match(handler, /inboundCalls\.markStreamIssued\(callSid\);\n    res\.type\('text\/xml'\)\.send\(twiml\);/);
  });

  it('package gate and unassigned reject still run before Stream on the fast path', () => {
    const fastAt = handler.indexOf('if (directoryHit) {\n      if (directoryHit.gate');
    const stream = handler.indexOf('const twiml = buildAnswerStreamXml(');
    const fast = handler.slice(fastAt, stream);
    assert.match(fast, /directoryHit\.gate\.open === false/);
    assert.match(fast, /directoryHit\.unassigned/);
  });

  it('a Completed for an answered sid is the hangup', () => {
    assert.match(handler, /let streamIssued = inboundCalls\.streamIssuedFor\(sid\);/);
    assert.match(handler, /shouldSkipMediaStream\(callSessionState, req\.body, sid, \{ streamIssued \}\)/);
  });

  it('ws/media reads the tenant the webhook resolved and waits for the row', () => {
    // ensureTenantPrompt memoizes; the load itself lives in loadTenantPrompt.
    const at = src.indexOf('async function loadTenantPrompt()');
    const body = src.slice(at, at + 1200);
    assert.match(body, /inboundCalls\.tenantIdFor\(sessionCallSid\)/);
    assert.match(body, /await inboundCalls\.awaitRow\(sessionCallSid, 2500\)/);
  });

  it('/ and /voice/incoming share the same handler', () => {
    assert.match(src, /function handleSautikitRootPost[\s\S]*?return handleVoiceIncoming\(req, res\)/);
    assert.match(src, /app\.post\('\/voice\/incoming',\s*sautikitWebhookGuard,\s*handleVoiceIncoming\)/);
  });
});
