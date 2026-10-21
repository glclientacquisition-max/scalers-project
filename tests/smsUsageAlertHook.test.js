// Run: node --test tests/smsUsageAlertHook.test.js
// sendLedger.reserveSend fires the package SMS 80%/100% check after a tenant SMS reserve.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function stubDb(exports) {
  const dbPath = require.resolve('../src/db');
  const prev = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports };
  return () => {
    if (prev) require.cache[dbPath] = prev;
    else delete require.cache[dbPath];
  };
}

function fakeDb({ replayed = false, allowed = true, checkThrows = false } = {}) {
  const checks = [];
  return {
    checks,
    reserveNotifySend: async () => ({ ok: true, id: 'n1', allowed, replayed, reason: allowed ? 'included' : 'sms_allowance_exhausted' }),
    checkSmsUsageAlertsForTenant: async (tenantId) => {
      checks.push(tenantId);
      if (checkThrows) throw new Error('boom');
    },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('reserveSend -> SMS usage alert hook', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('checks after a tenant SMS reserve, allowed or refused', async () => {
    const { reserveSend } = require('../src/notifications/sendLedger');
    for (const allowed of [true, false]) {
      const db = fakeDb({ allowed });
      restore = stubDb(db);
      const res = await reserveSend({ ledger: { tenantId: 't1', kind: 'lead' }, key: `k-${allowed}`, kind: 'lead', channel: 'sms', to: '+254700000000', body: 'hi' });
      await tick();
      assert.equal(res.mode, 'reserved');
      assert.deepEqual(db.checks, ['t1']);
      restore();
    }
  });

  it('does not check for WhatsApp/email, replays, or platform sends', async () => {
    const { reserveSend } = require('../src/notifications/sendLedger');
    let db = fakeDb();
    restore = stubDb(db);
    await reserveSend({ ledger: { tenantId: 't1', kind: 'lead' }, key: 'w', kind: 'lead', channel: 'whatsapp', to: '+254700000000', body: 'hi' });
    await reserveSend({ ledger: { tenantId: 't1', kind: 'lead' }, key: 'e', kind: 'lead', channel: 'email', to: 'a@b.c', body: 'hi' });
    await reserveSend({ ledger: { kind: 'platform_ops_package' }, key: 'p', kind: 'platform_ops_package', channel: 'email', to: 'ops@x.y', body: 'hi' });
    await tick();
    assert.deepEqual(db.checks, []);
    restore();
    db = fakeDb({ replayed: true });
    restore = stubDb(db);
    await reserveSend({ ledger: { tenantId: 't1', kind: 'lead' }, key: 'r', kind: 'lead', channel: 'sms', to: '+254700000000', body: 'hi' });
    await tick();
    assert.deepEqual(db.checks, []);
  });

  it('a failing check never fails the reserve', async () => {
    const { reserveSend } = require('../src/notifications/sendLedger');
    const db = fakeDb({ checkThrows: true });
    restore = stubDb(db);
    const res = await reserveSend({ ledger: { tenantId: 't1', kind: 'lead' }, key: 'x', kind: 'lead', channel: 'sms', to: '+254700000000', body: 'hi' });
    await tick();
    assert.equal(res.mode, 'reserved');
    assert.equal(res.allowed, true);
    assert.deepEqual(db.checks, ['t1']);
  });
});
