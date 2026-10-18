const { describe, it, beforeEach } = require('node:test');
const assert = require('assert');
const {
  maybeAlertSmsUsage,
  smsUsageThreshold,
  markerKind,
  resetSmsUsageAlerts,
} = require('../src/billing/smsUsageAlerts');
const { markerKind: minuteMarkerKind } = require('../src/billing/packageUsageAlerts');

function fakeDeps({ sendOk = true } = {}) {
  const markers = new Map();
  const sends = [];
  return {
    markers,
    sends,
    deps: {
      hasMarker: async (kind) => markers.has(kind),
      putMarker: async (kind, detail) => {
        markers.set(kind, detail);
      },
      send: async (event) => {
        sends.push(event);
        return sendOk ? { ok: true, channel: 'email' } : { ok: false, reason: 'no_ops_recipients' };
      },
    },
  };
}

const base = {
  tenantId: 't-1',
  businessName: 'Esga',
  smsIncluded: 200,
  enforcement: 'off',
  onDemand: false,
  periodStart: '2026-09-30T21:00:00+00:00',
};

describe('smsUsageAlerts', () => {
  beforeEach(() => resetSmsUsageAlerts());

  it('threshold: 0 below 80%, 80, 100; no included SMS never alerts', () => {
    assert.equal(smsUsageThreshold({ smsIncluded: 200, smsUsed: 159 }), 0);
    assert.equal(smsUsageThreshold({ smsIncluded: 200, smsUsed: 160 }), 80);
    assert.equal(smsUsageThreshold({ smsIncluded: 200, smsUsed: 199 }), 80);
    assert.equal(smsUsageThreshold({ smsIncluded: 200, smsUsed: 200 }), 100);
    assert.equal(smsUsageThreshold({ smsIncluded: 0, smsUsed: 50 }), 0);
  });

  it('sends nothing below 80%', async () => {
    const f = fakeDeps();
    const out = await maybeAlertSmsUsage({ ...base, smsUsed: 159 }, f.deps);
    assert.equal(out.skipped, 'below_80');
    assert.equal(f.sends.length, 0);
  });

  it('sends 80% once, then 100% once, per tenant per period (ops email kind)', async () => {
    const f = fakeDeps();
    await maybeAlertSmsUsage({ ...base, smsUsed: 160 }, f.deps);
    await maybeAlertSmsUsage({ ...base, smsUsed: 193 }, f.deps);
    assert.equal(f.sends.length, 1);
    assert.match(f.sends[0].subject, /80% of package SMS/);
    assert.equal(f.sends[0].kind, 'platform_ops_package');
    assert.match(f.sends[0].body, /Nothing is charged/);

    await maybeAlertSmsUsage({ ...base, smsUsed: 200 }, f.deps);
    await maybeAlertSmsUsage({ ...base, smsUsed: 240 }, f.deps);
    assert.equal(f.sends.length, 2);
    assert.match(f.sends[1].subject, /used all package SMS/);
  });

  it('durable markers stop repeats after a restart; SMS markers never collide with minute markers', async () => {
    const f = fakeDeps();
    await maybeAlertSmsUsage({ ...base, smsUsed: 200 }, f.deps);
    assert.equal(f.sends.length, 1);
    assert.ok(f.markers.has(markerKind(100, 't-1', '2026-09-30')));
    assert.ok(f.markers.has(markerKind(80, 't-1', '2026-09-30')));
    assert.notEqual(markerKind(80, 't-1', '2026-09-30'), minuteMarkerKind(80, 't-1', '2026-09-30'));
    resetSmsUsageAlerts();
    await maybeAlertSmsUsage({ ...base, smsUsed: 205 }, f.deps);
    assert.equal(f.sends.length, 1);
  });

  it('a new period alerts again', async () => {
    const f = fakeDeps();
    await maybeAlertSmsUsage({ ...base, smsUsed: 200 }, f.deps);
    await maybeAlertSmsUsage({ ...base, periodStart: '2026-10-31T21:00:00+00:00', smsUsed: 200 }, f.deps);
    assert.equal(f.sends.length, 2);
  });

  it('jumping past 100% sends only the 100% notice', async () => {
    const f = fakeDeps();
    await maybeAlertSmsUsage({ ...base, smsUsed: 440 }, f.deps);
    assert.equal(f.sends.length, 1);
    assert.match(f.sends[0].subject, /used all/);
  });

  it('enforced tenants are alerted too, with what happens to their texts', async () => {
    const f = fakeDeps();
    await maybeAlertSmsUsage({ ...base, tenantId: 't-2', enforcement: 'soft', onDemand: false, smsUsed: 200 }, f.deps);
    await maybeAlertSmsUsage({ ...base, tenantId: 't-3', enforcement: 'hard', onDemand: true, smsUsed: 200 }, f.deps);
    assert.equal(f.sends.length, 2);
    assert.match(f.sends[0].body, /fall back to WhatsApp or email/);
    assert.match(f.sends[1].body, /on-demand SMS rate/);
  });

  it('a failed send writes no marker and retries on a later send', async () => {
    const failing = fakeDeps({ sendOk: false });
    await maybeAlertSmsUsage({ ...base, smsUsed: 160 }, failing.deps);
    assert.equal(failing.markers.size, 0);
    await maybeAlertSmsUsage({ ...base, smsUsed: 161 }, failing.deps);
    assert.equal(failing.sends.length, 2);
  });

  it('no tenant -> skipped', async () => {
    const f = fakeDeps();
    const out = await maybeAlertSmsUsage({ smsIncluded: 200, smsUsed: 200 }, f.deps);
    assert.equal(out.skipped, 'no_tenant');
  });
});
