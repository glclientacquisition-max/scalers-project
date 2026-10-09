const { describe, it, beforeEach } = require('node:test');
const assert = require('assert');
const {
  maybeAlertPackageUsage,
  markerKind,
  periodKey,
  resetPackageUsageAlerts,
} = require('../src/billing/packageUsageAlerts');

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
  businessName: 'Aris Kenya',
  minutesIncluded: 300,
  enforcement: 'off',
  periodStart: '2026-09-30T21:00:00+00:00',
};

describe('packageUsageAlerts', () => {
  beforeEach(() => resetPackageUsageAlerts());

  it('sends nothing below 80%', async () => {
    const f = fakeDeps();
    const out = await maybeAlertPackageUsage({ ...base, secondsUsed: 239 * 60 }, f.deps);
    assert.equal(out.skipped, 'below_80');
    assert.equal(f.sends.length, 0);
  });

  it('sends 80% once, then 100% once, per tenant per period', async () => {
    const f = fakeDeps();
    await maybeAlertPackageUsage({ ...base, secondsUsed: 240 * 60 }, f.deps);
    await maybeAlertPackageUsage({ ...base, secondsUsed: 250 * 60 }, f.deps);
    assert.equal(f.sends.length, 1);
    assert.match(f.sends[0].subject, /80% of package minutes/);
    assert.equal(f.sends[0].kind, 'platform_ops_package');

    await maybeAlertPackageUsage({ ...base, secondsUsed: 300 * 60 }, f.deps);
    await maybeAlertPackageUsage({ ...base, secondsUsed: 400 * 60 }, f.deps);
    assert.equal(f.sends.length, 2);
    assert.match(f.sends[1].subject, /used all package minutes/);
    assert.match(f.sends[1].body, /Nothing is charged/);
  });

  it('durable markers stop repeats after a restart', async () => {
    const f = fakeDeps();
    await maybeAlertPackageUsage({ ...base, secondsUsed: 300 * 60 }, f.deps);
    assert.equal(f.sends.length, 1);
    assert.ok(f.markers.has(markerKind(100, 't-1', '2026-09-30')));
    assert.ok(f.markers.has(markerKind(80, 't-1', '2026-09-30')));
    resetPackageUsageAlerts(); // simulate new process
    await maybeAlertPackageUsage({ ...base, secondsUsed: 310 * 60 }, f.deps);
    assert.equal(f.sends.length, 1);
  });

  it('a new period alerts again', async () => {
    const f = fakeDeps();
    await maybeAlertPackageUsage({ ...base, secondsUsed: 300 * 60 }, f.deps);
    await maybeAlertPackageUsage(
      { ...base, periodStart: '2026-10-31T21:00:00+00:00', secondsUsed: 300 * 60 },
      f.deps
    );
    assert.equal(f.sends.length, 2);
  });

  it('jumping past 100% sends only the 100% notice', async () => {
    const f = fakeDeps();
    await maybeAlertPackageUsage({ ...base, secondsUsed: 500 * 60 }, f.deps);
    assert.equal(f.sends.length, 1);
    assert.match(f.sends[0].subject, /used all/);
  });

  it('does not alert enforced tenants (they get the cap gate instead)', async () => {
    const f = fakeDeps();
    for (const enforcement of ['soft', 'hard']) {
      const out = await maybeAlertPackageUsage({ ...base, enforcement, secondsUsed: 300 * 60 }, f.deps);
      assert.equal(out.skipped, 'enforced');
    }
    assert.equal(f.sends.length, 0);
  });

  it('a failed send writes no marker and retries on a later call', async () => {
    const failing = fakeDeps({ sendOk: false });
    await maybeAlertPackageUsage({ ...base, secondsUsed: 240 * 60 }, failing.deps);
    assert.equal(failing.markers.size, 0);
    await maybeAlertPackageUsage({ ...base, secondsUsed: 241 * 60 }, failing.deps);
    assert.equal(failing.sends.length, 2);
  });

  it('periodKey is the UTC date, or none without a package row', () => {
    assert.equal(periodKey(null), 'none');
    assert.equal(periodKey('2026-09-30T21:00:00+00:00'), '2026-09-30');
  });
});
