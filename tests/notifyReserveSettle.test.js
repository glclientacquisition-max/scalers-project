// Run: node --test tests/notifyReserveSettle.test.js
// Reserve -> send -> settle (docs/supabase/notify_send_reserve_settle.sql).
// The fake below mirrors the SQL semantics: one row per key, SMS units held
// at reserve, released on failed, failed/refused keys re-arm, sent is final.
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  callerKey,
  personKey,
  resetInstanceFlights,
} = require('../src/notifications/sendLedger');

function fakeLedgerDb({ included = 200, used = 0, enforcement = 'off', reserveError } = {}) {
  const rows = new Map();
  const state = { used, calls: [], consumed: 0, inserted: 0 };
  let seq = 0;
  const api = {
    state,
    rows,
    findNotifySend: async () => null,
    consumeSmsUnits: async () => {
      state.consumed += 1;
      return { allowed: true, reason: 'beta', overage: false };
    },
    insertNotifySend: async () => {
      state.inserted += 1;
      return { ok: true, id: 'legacy' };
    },
    reserveNotifySend: async (p) => {
      state.calls.push({ op: 'reserve', ...p });
      if (reserveError) return { ok: false, reason: reserveError };
      const k = `${p.tenantId || 'null'}|${p.idempotencyKey}`;
      const prior = rows.get(k);
      if (prior && (prior.status === 'pending' || prior.status === 'sent')) {
        return {
          ok: true, id: prior.id, allowed: false, replayed: true, status: prior.status,
          reason: prior.status === 'sent' ? 'already_sent' : 'in_flight',
        };
      }
      const metered = p.tenantId && p.billedTo === 'tenant' && p.channel === 'sms';
      const units = p.channel === 'sms' ? Math.max(1, p.units || 1) : 1;
      let allowed = true;
      let reason = metered ? 'included' : 'platform';
      if (metered && state.used + units > included && enforcement !== 'off') {
        allowed = false;
        reason = 'sms_allowance_exhausted';
      }
      const held = allowed && metered ? units : 0;
      const row = prior || { id: `n${++seq}`, attempts: 0 };
      Object.assign(row, {
        key: p.idempotencyKey, tenantId: p.tenantId, channel: p.channel, kind: p.kind,
        audience: p.audience, billedTo: p.billedTo, units, held,
        status: allowed ? 'pending' : 'refused', attempts: row.attempts + 1,
      });
      rows.set(k, row);
      state.used += held;
      return { ok: true, id: row.id, allowed, replayed: false, status: row.status, reason };
    },
    settleNotifySend: async ({ id, status, providerMessageId, failureReason }) => {
      state.calls.push({ op: 'settle', id, status, providerMessageId, failureReason });
      const row = [...rows.values()].find((r) => r.id === id);
      if (row.status !== 'pending') return { ok: true, status: row.status, replayed: true };
      row.status = status;
      row.providerMessageId = providerMessageId || null;
      if (status === 'failed') {
        state.used = Math.max(0, state.used - row.held);
        row.held = 0;
      }
      return { ok: true, status, replayed: false };
    },
  };
  return api;
}

function stubDb(exports) {
  const dbPath = require.resolve('../src/db');
  const prev = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports };
  return () => {
    if (prev) require.cache[dbPath] = prev;
    else delete require.cache[dbPath];
  };
}

function textsmsResponse(ok) {
  return {
    ok,
    status: ok ? 200 : 402,
    text: async () =>
      JSON.stringify({
        responses: [
          ok
            ? { 'respose-code': 200, 'response-description': 'Success', messageid: 77 }
            : { 'respose-code': 402, 'response-description': 'Insufficient balance' },
        ],
      }),
    json: async () => ({}),
  };
}

function mockProviders({ smsOk = true } = {}) {
  const hits = { sms: 0, email: 0 };
  mock.method(global, 'fetch', async (url) => {
    if (String(url).includes('resend.com')) {
      hits.email += 1;
      return { ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '{"id":"em_1"}' };
    }
    hits.sms += 1;
    return textsmsResponse(smsOk);
  });
  return hits;
}

const ENV = {
  TEXTSMS_API_KEY: 'k',
  TEXTSMS_PARTNER_ID: '1',
  TEXTSMS_SHORTCODE: 'SCALERS',
  RESEND_API_KEY: 're_test',
  ALERT_EMAIL_FROM: 'alerts@example.com',
  SAUTIKIT_API_KEY: '',
  SAUTIKIT_WHATSAPP_NUMBER_ID: '',
};

describe('notify reserve -> send -> settle', () => {
  let saved = {};
  const ledger = { tenantId: 't1', callSid: 'HD_1', callId: 'c1', kind: 'lead' };

  beforeEach(() => {
    resetInstanceFlights();
    saved = {};
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      if (v) process.env[k] = v;
      else delete process.env[k];
    }
  });

  afterEach(() => {
    mock.restoreAll();
    resetInstanceFlights();
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('keys staff alerts by person, not channel', () => {
    assert.equal(
      personKey(ledger, { to: '+254711000000', email: 'a@b.co' }),
      'call:t1:HD_1:lead:254711000000'
    );
    assert.equal(
      personKey({ ...ledger, recipientId: 'p-9' }, { to: '+254711000000' }),
      'call:t1:HD_1:lead:id_p-9'
    );
    assert.equal(
      personKey({ ...ledger, force: true, pingId: 'ping-1' }, { to: '0711000000' }),
      'ping:t1:c1:0711000000:ping-1'
    );
    assert.equal(
      personKey({ kind: 'platform_ops_speech', keyBase: 'ops:platform_ops_speech:123' }, { email: 'Ops@X.co' }),
      'ops:platform_ops_speech:123:email_ops@x.co'
    );
    assert.equal(callerKey(ledger, 'missed_textback', '254711000000'), 'call:t1:HD_1:missed_textback');
    assert.equal(callerKey({ tenantId: 't1', callId: 'c1' }, 'caller_hold'), 'row:t1:c1:caller_hold');
  });

  it('a failed SMS releases its units and the email fallback reuses the same row', async () => {
    const db = fakeLedgerDb({ used: 10 });
    const restore = stubDb(db);
    const hits = mockProviders({ smsOk: false });
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const result = await dispatchAlert({
        to: '+254711000000',
        email: 'owner@example.com',
        body: 'New lead',
        ledger: { ...ledger },
      });
      assert.equal(result.channel, 'email');
      assert.equal(hits.sms, 1);
      assert.equal(hits.email, 1);
      assert.equal(db.state.used, 10, 'SMS units released after the TextSMS 402');
      assert.equal(db.rows.size, 1, 'one row per person');
      const row = [...db.rows.values()][0];
      assert.equal(row.status, 'sent');
      assert.equal(row.channel, 'email');
      assert.equal(row.attempts, 2);
      assert.equal(db.state.consumed, 0, 'legacy consume_sms_units not called');
      assert.equal(db.state.inserted, 0, 'legacy insert not called');
      const settles = db.state.calls.filter((c) => c.op === 'settle').map((c) => c.status);
      assert.deepEqual(settles, ['failed', 'sent']);
    } finally {
      restore();
    }
  });

  it('a delivered SMS stays counted and stores the provider id', async () => {
    const db = fakeLedgerDb({ used: 0 });
    const restore = stubDb(db);
    mockProviders({ smsOk: true });
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const result = await dispatchAlert({ to: '+254711000000', body: 'New lead', ledger: { ...ledger } });
      assert.equal(result.channel, 'sms');
      assert.equal(db.state.used, 1);
      const row = [...db.rows.values()][0];
      assert.equal(row.status, 'sent');
      assert.equal(String(row.providerMessageId), '77');
    } finally {
      restore();
    }
  });

  it('a retry of a sent alert does not send or count again', async () => {
    const db = fakeLedgerDb({ used: 0 });
    const restore = stubDb(db);
    const hits = mockProviders({ smsOk: true });
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      await dispatchAlert({ to: '+254711000000', body: 'New lead', ledger: { ...ledger } });
      const again = await dispatchAlert({ to: '+254711000000', body: 'New lead', ledger: { ...ledger } });
      assert.equal(again.channel, null);
      assert.equal(again.reason, 'instance_already_sent');
      assert.equal(hits.sms, 1);
      assert.equal(db.state.used, 1);
    } finally {
      restore();
    }
  });

  it('refused SMS (allowance) falls back to email without counting', async () => {
    const db = fakeLedgerDb({ used: 200, included: 200, enforcement: 'hard' });
    const restore = stubDb(db);
    const hits = mockProviders({ smsOk: true });
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const result = await dispatchAlert({
        to: '+254711000000',
        email: 'owner@example.com',
        body: 'New lead',
        ledger: { ...ledger },
      });
      assert.equal(result.channel, 'email');
      assert.equal(hits.sms, 0);
      assert.equal(db.state.used, 200);
    } finally {
      restore();
    }
  });

  it('falls back to the legacy consume + insert path while the RPC is not applied', async () => {
    const db = fakeLedgerDb({ reserveError: 'rpc_missing' });
    const restore = stubDb(db);
    mockProviders({ smsOk: true });
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const result = await dispatchAlert({ to: '+254711000000', body: 'New lead', ledger: { ...ledger } });
      assert.equal(result.channel, 'sms');
      assert.equal(db.state.consumed, 1);
      assert.equal(db.state.inserted, 1);
    } finally {
      restore();
    }
  });

  it('fails closed for tenant SMS when the RPC errors, and still emails', async () => {
    const db = fakeLedgerDb({ reserveError: 'rpc_failed' });
    const restore = stubDb(db);
    const hits = mockProviders({ smsOk: true });
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const result = await dispatchAlert({
        to: '+254711000000',
        email: 'owner@example.com',
        body: 'New lead',
        ledger: { ...ledger },
      });
      assert.equal(result.channel, 'email');
      assert.equal(hits.sms, 0, 'no unmetered SMS');
      assert.equal(db.state.consumed, 0);
    } finally {
      restore();
    }
  });

  it('records platform ops alerts as tenant-less platform rows', async () => {
    const db = fakeLedgerDb();
    const restore = stubDb(db);
    mockProviders();
    try {
      const { dispatchToStaff } = require('../src/notifications/recipients');
      const { sent } = await dispatchToStaff({
        recipients: [{ name: 'Alvin', email: 'ops@example.com' }],
        body: 'Speech down',
        subject: 'Scalers platform speech down',
        channels: { sms: false, whatsapp: false, email: true },
        ledger: { kind: 'platform_ops_speech', keyBase: 'ops:platform_ops_speech:1700000000000' },
      });
      assert.equal(sent.length, 1);
      const reserve = db.state.calls.find((c) => c.op === 'reserve');
      assert.equal(reserve.tenantId, null);
      assert.equal(reserve.billedTo, 'platform');
      assert.equal(reserve.audience, 'platform');
      assert.equal(reserve.idempotencyKey, 'ops:platform_ops_speech:1700000000000:email_ops@example.com');
      assert.equal([...db.rows.values()][0].status, 'sent');
    } finally {
      restore();
    }
  });

  it('caller SMS: a TextSMS failure is settled failed and releases units', async () => {
    const db = fakeLedgerDb({ used: 5 });
    const restore = stubDb(db);
    mockProviders({ smsOk: false });
    try {
      const { dispatchCallerSms } = require('../src/notifications/callerSms');
      await assert.rejects(
        dispatchCallerSms({
          to: '+254711000000',
          event: { kind: 'caller_appointment', caller: { phone: '+254711000000' }, business: { name: 'Esga' }, appointment: { when: 'Mon 10:00' } },
          channels: { caller_sms: true },
          ledger: { tenantId: 't1', callSid: 'HD_2', callId: 'c2' },
        })
      );
      assert.equal(db.state.used, 5);
      const row = [...db.rows.values()][0];
      assert.equal(row.status, 'failed');
      assert.equal(row.key, 'call:t1:HD_2:caller_appointment');
    } finally {
      restore();
    }
  });

  it('missed-call text-back is keyed per call and released on failure', async () => {
    const db = fakeLedgerDb({ used: 3 });
    const restore = stubDb(db);
    mockProviders({ smsOk: false });
    try {
      const { sendMissedTextback } = require('../src/notifications/missedTextback');
      await assert.rejects(
        sendMissedTextback({ to: '+254711000000', businessName: 'Esga', ledger: { tenantId: 't1', callSid: 'HD_3' } })
      );
      assert.equal(db.state.used, 3);
      assert.equal([...db.rows.values()][0].key, 'call:t1:HD_3:missed_textback');
    } finally {
      restore();
    }
  });
});
