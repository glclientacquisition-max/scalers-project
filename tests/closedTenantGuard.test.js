'use strict';

// Closed-tenant guard (VOICE_CLOSED_TENANT_GUARD, default on): no SMS /
// WhatsApp / email, Desk re-ping, Brain tool write, live-transfer Dial or
// greeting render for an archived, suspended or is_active=false business.
// Lookup errors fail open with a log, the same as the inbound gate (#639/#651).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  closedTenantGuardEnabled,
  createTenantLineCache,
  tenantLineForAction,
  closedLineRefusal,
  warmableTenantRows,
} = require('../src/sautikit/closedTenantGuard');

const ROWS = {
  active: { id: 'active', is_active: true, archived_at: null, line_status: 'active' },
  suspended: { id: 'suspended', is_active: true, archived_at: null, line_status: 'suspended' },
  archived: { id: 'archived', is_active: true, archived_at: '2026-10-17T10:00:00Z', line_status: 'active' },
  inactive: { id: 'inactive', is_active: false, archived_at: null, line_status: 'active' },
};

const STATES = {
  active: { closed: false, reason: 'live', tenantId: 'active' },
  suspended: { closed: true, reason: 'suspended', tenantId: 'suspended' },
  archived: { closed: true, reason: 'archived', tenantId: 'archived' },
  inactive: { closed: true, reason: 'inactive', tenantId: 'inactive' },
};

function stubDb(exports) {
  const dbPath = require.resolve('../src/db');
  const prev = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports };
  return () => {
    if (prev) require.cache[dbPath] = prev;
    else delete require.cache[dbPath];
  };
}

function withEnv(key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  const done = () => {
    if (had) process.env[key] = prev;
    else delete process.env[key];
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(done);
    done();
    return out;
  } catch (err) {
    done();
    throw err;
  }
}

function captureWarn() {
  const lines = [];
  const real = console.warn;
  console.warn = (...args) => lines.push(args.join(' '));
  return { lines, restore: () => { console.warn = real; } };
}

describe('VOICE_CLOSED_TENANT_GUARD', () => {
  it('defaults on; off / 0 / false / no turn it off', () => {
    assert.equal(closedTenantGuardEnabled({}), true);
    assert.equal(closedTenantGuardEnabled({ VOICE_CLOSED_TENANT_GUARD: 'on' }), true);
    for (const off of ['off', '0', 'false', 'no', ' OFF ']) {
      assert.equal(closedTenantGuardEnabled({ VOICE_CLOSED_TENANT_GUARD: off }), false, off);
    }
  });
});

describe('createTenantLineCache', () => {
  function cache(opts = {}) {
    const calls = [];
    const logs = [];
    let t = 0;
    const c = createTenantLineCache({
      loadRows: async (id) => {
        calls.push(id);
        if (opts.fail) throw new Error('timeout');
        return { data: ROWS[id] ? [ROWS[id]] : [], error: null };
      },
      ttlMs: 60_000,
      now: () => t,
      log: (m) => logs.push(m),
    });
    return { c, calls, logs, tick: (ms) => { t += ms; } };
  }

  it('suspended, archived and is_active=false are closed; active is open', async () => {
    const { c } = cache();
    for (const key of Object.keys(ROWS)) assert.deepEqual(await c.lineFor(key), STATES[key], key);
  });

  it('caches for the TTL, then reads again', async () => {
    const { c, calls, tick } = cache();
    await c.lineFor('suspended');
    await c.lineFor('suspended');
    assert.equal(calls.length, 1);
    tick(60_001);
    await c.lineFor('suspended');
    assert.equal(calls.length, 2);
  });

  it('shares one in-flight lookup', async () => {
    const { c, calls } = cache();
    await Promise.all([c.lineFor('archived'), c.lineFor('archived'), c.lineFor('archived')]);
    assert.equal(calls.length, 1);
  });

  it('a lookup error answers open with a log and is not cached', async () => {
    const { c, calls, logs } = cache({ fail: true });
    assert.deepEqual(await c.lineFor('suspended'), { closed: false, reason: 'lookup_failed', tenantId: 'suspended' });
    assert.match(logs[0], /line lookup failed tenant=suspended \(treating as open\): timeout/);
    await c.lineFor('suspended');
    assert.equal(calls.length, 2);
  });

  it('a Supabase-style { error } answers open too', async () => {
    const logs = [];
    const c = createTenantLineCache({ loadRows: async () => ({ data: null, error: { message: 'relation missing' } }), log: (m) => logs.push(m) });
    assert.equal((await c.lineFor('x')).closed, false);
    assert.match(logs[0], /relation missing/);
  });

  it('no tenant id answers open without a lookup', async () => {
    const { c, calls } = cache();
    assert.equal((await c.lineFor('')).closed, false);
    assert.equal(calls.length, 0);
  });
});

describe('tenantLineForAction', () => {
  it('asks db.tenantLineClosed when on', async () => {
    const db = { tenantLineClosed: async (id) => STATES[id] };
    for (const key of Object.keys(STATES)) {
      assert.deepEqual(await tenantLineForAction(key, { env: {}, db }), STATES[key]);
    }
  });

  it('off: never asks, always open', async () => {
    let asked = 0;
    const db = { tenantLineClosed: async () => { asked += 1; return STATES.suspended; } };
    const out = await tenantLineForAction('suspended', { env: { VOICE_CLOSED_TENANT_GUARD: 'off' }, db });
    assert.equal(out.closed, false);
    assert.equal(asked, 0);
  });

  it('a thrown lookup answers open with a log', async () => {
    const logs = [];
    const db = { tenantLineClosed: async () => { throw new Error('boom'); } };
    const out = await tenantLineForAction('suspended', { env: {}, db, log: (m) => logs.push(m) });
    assert.deepEqual(out, { closed: false, reason: 'lookup_failed', tenantId: 'suspended' });
    assert.match(logs[0], /line check failed tenant=suspended \(treating as open\): boom/);
  });
});

describe('beginInstanceSend: the shared send gate', () => {
  const { beginInstanceSend, resetInstanceFlights } = require('../src/notifications/sendLedger');
  let asked;
  let restoreDb;
  let mode;

  beforeEach(() => {
    resetInstanceFlights();
    asked = [];
    mode = 'ok';
    restoreDb = stubDb({
      findNotifySend: async () => null,
      tenantLineClosed: async (id) => {
        asked.push(id);
        if (mode === 'throw') throw new Error('db down');
        return STATES[id] || { closed: false, reason: 'no_tenant', tenantId: id };
      },
    });
  });
  afterEach(() => {
    restoreDb();
    resetInstanceFlights();
  });

  for (const key of ['suspended', 'archived', 'inactive']) {
    it(`${key}: { ok:false, reason:'tenant_line_closed' }`, async () => {
      const w = captureWarn();
      try {
        const out = await beginInstanceSend({ tenantId: key, callSid: 'HD_x', kind: 'lead' }, '254711000000');
        assert.equal(out.ok, false);
        assert.equal(out.reason, 'tenant_line_closed');
        assert.equal(out.lineState, key);
        assert.ok(w.lines.some((l) => l.includes(`send blocked: tenant line closed (${key}) tenant=${key}`)));
      } finally {
        w.restore();
      }
    });
  }

  it('active tenant passes', async () => {
    const out = await beginInstanceSend({ tenantId: 'active', callSid: 'HD_x', kind: 'lead' }, '254711000000');
    assert.equal(out.ok, true);
    assert.deepEqual(asked, ['active']);
  });

  it('no tenant id still passes and never asks', async () => {
    const out = await beginInstanceSend({ callSid: 'HD_x', kind: 'lead' }, '254711000000');
    assert.equal(out.ok, true);
    assert.deepEqual(asked, []);
  });

  it('lookup error fails open (logged)', async () => {
    mode = 'throw';
    const w = captureWarn();
    try {
      const out = await beginInstanceSend({ tenantId: 'suspended', kind: 'lead' }, '254711000000');
      assert.equal(out.ok, true);
      assert.ok(w.lines.some((l) => /line check failed tenant=suspended/.test(l)));
    } finally {
      w.restore();
    }
  });

  it('flag off restores the old behaviour', async () => {
    await withEnv('VOICE_CLOSED_TENANT_GUARD', 'off', async () => {
      const out = await beginInstanceSend({ tenantId: 'suspended', kind: 'lead' }, '254711000000');
      assert.equal(out.ok, true);
      assert.deepEqual(asked, []);
    });
  });

  it('dispatchAlert (owner lead / escalation / wallet) returns the refusal and sends nothing', async () => {
    const { dispatchAlert } = require('../src/notifications/dispatch');
    let fetched = 0;
    const realFetch = global.fetch;
    global.fetch = async () => { fetched += 1; throw new Error('no network in tests'); };
    const w = captureWarn();
    try {
      const out = await dispatchAlert({
        to: '+254711000000',
        email: 'owner@example.com',
        body: 'New lead',
        ledger: { tenantId: 'suspended', callSid: 'HD_x', kind: 'lead' },
      });
      assert.deepEqual(out, { channel: null, reason: 'tenant_line_closed' });
      assert.equal(fetched, 0);
    } finally {
      w.restore();
      global.fetch = realFetch;
    }
  });

  it('caller SMS and missed-call text-back stop at the same gate', async () => {
    const { dispatchCallerSms } = require('../src/notifications/callerSms');
    const { sendMissedTextback } = require('../src/notifications/missedTextback');
    const sms = require('../src/notifications/sms');
    const realReady = sms.isSmsConfigured;
    const w = captureWarn();
    await withEnv('TEXTSMS_API_KEY', 'test', () =>
      withEnv('TEXTSMS_PARTNER_ID', '1', () =>
        withEnv('TEXTSMS_SHORTCODE', 'TEST', async () => {
          try {
            const caller = await dispatchCallerSms({
              to: '+254711000000',
              event: { kind: 'caller_callback', business: { name: 'Unpaid Co' }, caller: { phone: '+254711000000' } },
              channels: { caller_sms: true },
              ledger: { tenantId: 'archived', callSid: 'HD_y' },
            });
            assert.equal(caller.reason, 'tenant_line_closed');
            const textback = await sendMissedTextback({
              to: '+254711000000',
              businessName: 'Paused Co',
              ledger: { tenantId: 'inactive', callSid: 'HD_z' },
            });
            assert.equal(textback.reason, 'tenant_line_closed');
          } finally {
            w.restore();
            sms.isSmsConfigured = realReady;
          }
        })
      )
    );
  });
});

describe('Brain tool writes', () => {
  const { executeBrainTools, brainToolsWantWrite } = require('../src/conversation/toolExecution');

  it('brainToolsWantWrite: writes yes, read-only no', () => {
    assert.equal(brainToolsWantWrite({ serviceRequest: { type: 'callback' } }), true);
    assert.equal(brainToolsWantWrite({ appointment: {} }), true);
    assert.equal(brainToolsWantWrite({ appointmentUpdate: {} }), true);
    assert.equal(brainToolsWantWrite({ escalate: { reason: 'x' } }), true);
    assert.equal(brainToolsWantWrite({ name: 'Wanjiku' }), true);
    assert.equal(brainToolsWantWrite({ shouldEndCall: true }), false);
    assert.equal(brainToolsWantWrite(null), false);
  });

  it('closed line: every write is disabled (line_closed) and no handler runs', async () => {
    const ran = [];
    const handler = (name) => async () => { ran.push(name); return { ok: true }; };
    const out = await executeBrainTools({
      parsed: {
        name: 'Wanjiku',
        reason: 'Sofa cleaning quote',
        serviceRequest: { type: 'callback', name: 'Wanjiku', item: 'sofa cleaning' },
        appointment: { name: 'Wanjiku', service_name: 'sofa cleaning', when_text: 'tomorrow 10am' },
        escalate: { name: 'Wanjiku', reason: 'Wants the owner' },
        shouldEndCall: true,
      },
      lineClosed: 'suspended',
      capabilities: { createServiceRequest: true, createAppointment: true, escalate: true, endCall: true, confirmVisit: true },
      handlers: {
        createServiceRequest: handler('createServiceRequest'),
        createAppointment: handler('createAppointment'),
        saveCallerInfo: handler('saveCallerInfo'),
        escalate: handler('escalate'),
      },
    });
    assert.deepEqual(ran, []);
    assert.deepEqual(
      out.results.map((r) => [r.action, r.status, r.code, r.lineState]),
      [
        ['create_service_request', 'disabled', 'line_closed', 'suspended'],
        ['create_appointment', 'disabled', 'line_closed', 'suspended'],
        ['save_caller_info', 'disabled', 'line_closed', 'suspended'],
        ['escalate', 'disabled', 'line_closed', 'suspended'],
      ]
    );
    assert.equal(out.shouldEndCall, false);
  });

  it('open line: the same plan still runs its handlers', async () => {
    const ran = [];
    const out = await executeBrainTools({
      parsed: { name: 'Wanjiku', reason: 'Sofa cleaning quote' },
      lineClosed: null,
      nameConfirmed: true,
      handlers: { saveCallerInfo: async () => { ran.push('saveCallerInfo'); return { ok: true, name: 'Wanjiku' }; } },
    });
    assert.deepEqual(ran, ['saveCallerInfo']);
    assert.equal(out.results[0].action, 'save_caller_info');
    assert.notEqual(out.results[0].code, 'line_closed');
  });
});

describe('greeting warm-up and route refusals', () => {
  const rows = [ROWS.active, ROWS.suspended, ROWS.archived, ROWS.inactive, { id: 'grace', is_active: true, line_status: 'grace' }];

  it('guard on: only live lines warm (suspended, archived, is_active=false skipped)', () => {
    assert.deepEqual(warmableTenantRows(rows, {}).map((r) => r.id), ['active', 'grace']);
  });

  it('guard off: the old rule (is_active and archived_at only; suspended still warms)', () => {
    assert.deepEqual(
      warmableTenantRows(rows, { VOICE_CLOSED_TENANT_GUARD: 'off' }).map((r) => r.id),
      ['active', 'suspended', 'grace']
    );
  });

  it('closedLineRefusal is a clear JSON refusal', () => {
    assert.deepEqual(closedLineRefusal(STATES.suspended), {
      ok: false,
      reason: 'tenant_line_closed',
      lineState: 'suspended',
      tenantId: 'suspended',
      message: 'This business line is suspended. Nothing was sent.',
    });
    assert.equal(closedLineRefusal(STATES.archived).lineState, 'archived');
    assert.equal(closedLineRefusal(STATES.inactive).lineState, 'inactive');
  });
});

describe('server.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const slice = (from, len = 2500) => src.slice(src.indexOf(from), src.indexOf(from) + len);

  it('/internal/desk/escalate refuses a closed line with 409 JSON before any send', () => {
    const route = slice("app.post('/internal/desk/escalate'");
    const check = route.indexOf('tenantLineForAction(tenantId)');
    const send = route.indexOf('maybeSendEscalationNotification(');
    assert.ok(check > 0 && send > check);
    assert.match(route, /res\.status\(409\)\.json\(closedLineRefusal\(line\)\)/);
    assert.match(route, /closedTenantGuardEnabled\(\)/);
  });

  it('/internal/greeting-warm skips a closed line before rendering', () => {
    const route = slice("app.post('/internal/greeting-warm'");
    assert.ok(route.indexOf('tenantLineForAction(tenantId)') < route.indexOf('greetingWarmer.warmTenant('));
  });

  it('the warm sweep lists tenants through warmableTenantRows', () => {
    assert.match(slice('createGreetingWarmer({', 600), /warmableTenantRows\(rows\)/);
  });

  it('maybeQueueLiveTransfer and Brain tools ask callTenantLineClosed', () => {
    const transfer = slice('async function maybeQueueLiveTransfer(', 1200);
    assert.ok(transfer.indexOf('callTenantLineClosed(profile)') < transfer.indexOf('queuePendingLiveTransfer('));
    const tools = slice('async function applyGeminiTools(', 3500);
    assert.match(tools, /brainToolsWantWrite\(enforcedParsed\)[\s\S]*callTenantLineClosed\(groundedProfile\)/);
    assert.match(tools, /lineClosed: closedLine \? closedLine\.reason/);
  });

  it('callTenantLineClosed honours the flag and the call-start profile', () => {
    const fn = slice('async function callTenantLineClosed(', 400);
    assert.match(fn, /if \(!closedTenantGuardEnabled\(\)\) return null;/);
    assert.match(fn, /profile\?\.lineState\?\.closed/);
  });
});
