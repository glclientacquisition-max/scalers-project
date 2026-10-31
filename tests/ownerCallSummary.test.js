// Run: node --test tests/ownerCallSummary.test.js
// A4 Ops sender: one owner message per call from `call.summary.ready`.
// Replays HD_8a8aa14db292 (Aris, 19 Oct): 4-5 owner SMS per call, an answered
// call labelled "missed-call lead", "Order 10 protractors" sent with no write.
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

process.env.CALL_SUMMARY_EVENT = 'on';
const E = require('../src/conversation/callSummaryEvent');
const {
  createOwnerSummarySender,
  ownerCallSummaryEnabled,
  legacyOwnerSendsSuppressed,
  sendOwnerSummaryToPerson,
  withStickyFailure,
} = require('../src/notifications/ownerCallSummary');
const { renderOwnerSummary, renderFallback } = require('../src/notifications/ownerSummaryText');
const { resetInstanceFlights } = require('../src/notifications/sendLedger');

// ---- fakes -------------------------------------------------------------------

function fakeLedgerDb({ included = 200, used = 0, enforcement = 'off', settleFailures = 0 } = {}) {
  const rows = new Map();
  const state = { used, calls: [], consumed: 0, inserted: 0, settleFailures };
  let seq = 0;
  return {
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
      const k = `${p.tenantId || 'null'}|${p.idempotencyKey}`;
      const prior = rows.get(k);
      if (prior && (prior.status === 'pending' || prior.status === 'sent')) {
        return { ok: true, id: prior.id, allowed: false, replayed: true, reason: prior.status === 'sent' ? 'already_sent' : 'in_flight' };
      }
      const metered = p.tenantId && p.billedTo === 'tenant' && p.channel === 'sms';
      const units = p.channel === 'sms' ? Math.max(1, p.units || 1) : 1;
      let allowed = true;
      if (metered && state.used + units > included && enforcement !== 'off') allowed = false;
      const held = allowed && metered ? units : 0;
      const row = prior || { id: `n${++seq}`, attempts: 0 };
      Object.assign(row, { key: p.idempotencyKey, channel: p.channel, kind: p.kind, units, held, status: allowed ? 'pending' : 'refused', attempts: row.attempts + 1, body: p.body });
      rows.set(k, row);
      state.used += held;
      return { ok: true, id: row.id, allowed, replayed: false, reason: allowed ? 'included' : 'sms_allowance_exhausted' };
    },
    settleNotifySend: async ({ id, status }) => {
      state.calls.push({ op: 'settle', id, status });
      if (state.settleFailures > 0) {
        state.settleFailures -= 1;
        return { ok: false, reason: 'network' };
      }
      const row = [...rows.values()].find((r) => r.id === id);
      if (row.status !== 'pending') return { ok: true, replayed: true };
      row.status = status;
      if (status === 'failed') {
        state.used = Math.max(0, state.used - row.held);
        row.held = 0;
      }
      return { ok: true, status };
    },
  };
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

function mockTextSms({ ok = true } = {}) {
  const hits = { sms: 0, bodies: [] };
  mock.method(global, 'fetch', async (url, init) => {
    hits.sms += 1;
    try {
      hits.bodies.push(JSON.parse(init?.body || '{}').message || '');
    } catch {
      hits.bodies.push('');
    }
    return {
      ok,
      status: ok ? 200 : 402,
      text: async () =>
        JSON.stringify({
          responses: [ok ? { 'respose-code': 200, 'response-description': 'Success', messageid: 77 } : { 'respose-code': 402, 'response-description': 'Insufficient balance' }],
        }),
      json: async () => ({}),
    };
  });
  return hits;
}

/** Manual clock + timers. */
function clock(start = Date.parse('2026-10-19T10:14:58Z')) {
  let t = start;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const h = { fn, at: t + Math.max(0, ms), done: false };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => {
      if (h) h.done = true;
    },
    async advance(ms) {
      const until = t + ms;
      for (;;) {
        const due = timers.filter((h) => !h.done && h.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at;
        due.done = true;
        await due.fn();
        await new Promise((r) => setImmediate(r));
      }
      t = until;
      await new Promise((r) => setImmediate(r));
    },
  };
}

const CALL = {
  id: 'c5d6ba83-0000-4000-8000-000000000001',
  tenant_id: 'ten_aris',
  call_sid: 'HD_8a8aa14db292',
  from_number: '+254790381872',
  name: 'Alvin Yegon',
  reason: 'Order 10 protractors',
  status: 'complete',
  summary: '{}',
};
const PROFILE = {
  id: 'ten_aris',
  businessName: 'Aris Kenya',
  whatsappNumber: '+254711000001',
  alertEmail: null,
  notifyChannels: null,
  teamDirectory: [],
};

function callDb(call = CALL, profile = PROFILE) {
  const row = { ...call };
  const calls = { merged: [], marked: [] };
  return {
    calls,
    row,
    getCall: async () => ({ ...row }),
    getTenantProfile: async () => ({ ...profile }),
    markWhatsappSent: async (sid, outcome) => {
      calls.marked.push({ sid, outcome });
    },
    mergeCallSummaryMeta: async ({ patch }) => {
      calls.merged.push(patch);
      const meta = JSON.parse(row.summary || '{}');
      row.summary = JSON.stringify({ ...meta, ...patch });
    },
  };
}

/** HD_8a8aa14db292 as Brain's v1 builder emits it: order tool invalid x2, no write. */
function hd8a8aEvent(extra = {}) {
  const out = E.buildCallSummaryEvent({
    path: 'v1',
    callLanguage: 'en',
    callId: CALL.id,
    tenantId: 'ten_aris',
    answered: true,
    infoAnswered: true,
    caller: { name: 'Alvin Yegon', phone: '+254790381872' },
    receipts: [
      {
        receiptId: 'v1_1',
        type: 'order',
        status: 'unconfirmed',
        slots: { pickup: { status: 'not_given' }, name: { value: 'Alvin Yegon', status: 'given' } },
        // "Protractor" matched no row by name (2 variants): catalogueId null, no price, stock unconfirmed.
        items: [{ catalogueId: null, name: 'Protractor', qty: { value: 10, status: 'given' }, stock: 'unconfirmed' }],
      },
    ],
    now: new Date('2026-10-19T10:15:00Z'),
    ...extra,
  });
  assert.equal(out.ok, true, out.errors.join('; '));
  return out.event;
}

const ENV = {
  TEXTSMS_API_KEY: 'k',
  TEXTSMS_PARTNER_ID: '1',
  TEXTSMS_SHORTCODE: 'SCALERS',
  OWNER_CALL_SUMMARY: 'on',
  OWNER_SUMMARY_SUPPRESS_LEGACY: 'on',
  CALL_SUMMARY_EVENT: 'on',
  SAUTIKIT_API_KEY: '',
  SAUTIKIT_WHATSAPP_NUMBER_ID: '',
  RESEND_API_KEY: '',
  ALERT_EMAIL_FROM: '',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};

let saved = {};
function setEnv() {
  saved = {};
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
}
function restoreEnv() {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  process.env.CALL_SUMMARY_EVENT = 'on';
}

function makeSender(db, c, extra = {}) {
  return createOwnerSummarySender({
    db,
    callDeskUrl: (id) => (id ? `https://desk.example/calls/${id}` : null),
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    log: { log() {}, warn() {} },
    ...extra,
  });
}

// ---- tests -------------------------------------------------------------------

describe('owner call summary: flags', () => {
  afterEach(restoreEnv);
  it('is off by default and needs CALL_SUMMARY_EVENT; suppression needs the sender', () => {
    assert.equal(ownerCallSummaryEnabled({}), false);
    assert.equal(ownerCallSummaryEnabled({ OWNER_CALL_SUMMARY: 'on' }), false);
    assert.equal(ownerCallSummaryEnabled({ OWNER_CALL_SUMMARY: 'on', CALL_SUMMARY_EVENT: 'on' }), true);
    assert.equal(legacyOwnerSendsSuppressed({ OWNER_SUMMARY_SUPPRESS_LEGACY: 'on', CALL_SUMMARY_EVENT: 'on' }), false);
    assert.equal(
      legacyOwnerSendsSuppressed({ OWNER_SUMMARY_SUPPRESS_LEGACY: 'on', OWNER_CALL_SUMMARY: 'on', CALL_SUMMARY_EVENT: 'on' }),
      true
    );
    assert.equal(legacyOwnerSendsSuppressed({ OWNER_CALL_SUMMARY: 'on', CALL_SUMMARY_EVENT: 'on' }), false);
  });

  it('sends nothing while OWNER_CALL_SUMMARY is off', async () => {
    const c = clock();
    const db = callDb();
    const sent = [];
    const s = makeSender(db, c, { enabled: () => false, sendToPerson: async (o) => { sent.push(o); return { channel: 'sms' }; } });
    assert.equal(s.onEvent(hd8a8aEvent()).action, 'disabled');
    await s.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
    await c.advance(10 * 60 * 1000);
    assert.equal(sent.length, 0);
  });
});

describe('owner call summary: render', () => {
  it('HD_8a8aa14db292: enquiry label, unconfirmed order never sold as an order', () => {
    const { text, label } = renderOwnerSummary(hd8a8aEvent(), { businessName: 'Aris Kenya', callUrl: 'https://desk.example/calls/x' });
    assert.equal(label, 'Enquiry');
    assert.doesNotMatch(text, /missed-call lead|missed call/i);
    assert.doesNotMatch(text, /^Order:/m);
    assert.match(text, /^Enquiry - Aris Kenya$/m);
    assert.match(text, /Caller: Alvin Yegon, \+254790381872/);
    assert.match(text, /Interested in 10 x Protractor \(price to confirm, stock to confirm\), not confirmed\. Pickup: not given\./);
    assert.doesNotMatch(text, /in stock/i);
    assert.match(text, /Open call: https:\/\/desk\.example\/calls\/x/);
    assert.match(text, /^[\x20-\x7e\n]+$/, 'GSM-7 safe');
  });

  it('confirmed order with a price range and stock; missing qty; Swahili', () => {
    const ev = {
      schemaVersion: 1, callLanguage: 'sw', outcome: 'ordered', urgent: false, callId: 'c', tenantId: 't',
      caller: { phone: null },
      receipts: [{
        receiptId: 'r1', type: 'order', status: 'confirmed', writtenRowId: 'sr_1',
        slots: { pickup: { value: 'kesho', status: 'given' }, name: { status: 'not_given' } },
        items: [
          { catalogueId: 'p1', name: 'T-square', qty: { value: 2, status: 'given' }, unitPrice: { min: 800, max: 1200, unit: 'each' }, stock: 'in_stock' },
          { catalogueId: null, name: '180\u00b0 protractor', qty: { status: 'not_given' }, stock: 'out_of_stock' },
        ],
      }],
    };
    const { text, label } = renderOwnerSummary(ev, { businessName: 'Aris' });
    assert.equal(label, 'Oda');
    assert.match(text, /Mpigaji: namba haikupatikana/);
    assert.match(text, /Oda: 2 x T-square \(KSh 800-1,200 kila moja, ipo\); 180 deg protractor \(idadi haijatolewa\) \(bei ithibitishwe, imeisha\)\. Kuchukua: kesho\./);
    const en = renderOwnerSummary({ ...ev, callLanguage: 'en' }, {}).text;
    assert.match(en, /Order: 2 x T-square \(KSh 800-1,200 each, in stock\)/);
    assert.match(en, /Caller: number not captured/);
  });

  it('unconfirmed callback and confirmed booking; missing slots say "not given"', () => {
    const ev = {
      schemaVersion: 1, callLanguage: 'en', outcome: 'callback_needed', urgent: false, callId: 'c', tenantId: 't',
      caller: { name: 'Wanjiku', phone: '+254722000111' },
      receipts: [
        { receiptId: 'r1', type: 'callback', status: 'unconfirmed', slots: { reason: { value: 'deep clean quote', status: 'given' }, name: { value: 'Wanjiku', status: 'given' } } },
        { receiptId: 'r2', type: 'booking', status: 'unconfirmed', slots: { service: { value: 'Deep clean, 1 bedroom', status: 'given' }, when: { status: 'not_given' }, place: { status: 'not_given' } } },
      ],
    };
    const { text, label } = renderOwnerSummary(ev, {});
    assert.equal(label, 'Callback needed');
    assert.match(text, /Asked for a callback, number\/time not confirmed\. \+254722000111\. Reason: deep clean quote\./);
    assert.match(text, /Interested in Deep clean, 1 bedroom, not confirmed\. When: not given\. Place: not given\./);
    assert.doesNotMatch(text, /^Booking:/m);
    const booked = renderOwnerSummary({ ...ev, outcome: 'booked', receipts: [{ ...ev.receipts[1], status: 'confirmed', writtenRowId: 'a1' }] }, {}).text;
    assert.match(booked, /^Booking$/m);
    assert.match(booked, /Booking: Deep clean, 1 bedroom\. When: not given\. Place: not given\./);
  });

  it('ignores the top-level event field and only labels a never-answered call missed', () => {
    const ev = hd8a8aEvent();
    assert.equal(ev.event, 'call.summary.ready');
    const a = renderOwnerSummary(ev, {}).text;
    const b = renderOwnerSummary({ ...ev, event: 'something-else' }, {}).text;
    assert.equal(a, b);
    assert.match(renderFallback({ answered: false, callerPhone: '+254700000001' }).text, /^Missed call from \+254700000001/);
    assert.match(renderFallback({ answered: true, callerPhone: null }).text, /^Call from number not captured, no details captured/);
  });
});

describe('owner call summary: sender', () => {
  beforeEach(() => {
    setEnv();
    resetInstanceFlights();
  });
  afterEach(() => {
    mock.restoreAll();
    resetInstanceFlights();
    restoreEnv();
  });

  it('HD_8a8aa14db292 replay: one message, correct label, single unit charge, re-emit never resends', async () => {
    const ledgerDb = fakeLedgerDb({ used: 40 });
    const restore = stubDb(ledgerDb);
    const hits = mockTextSms();
    try {
      const c = clock();
      const db = callDb();
      const s = makeSender(db, c);
      await s.noteCallEnded({ callSid: CALL.call_sid, call: db.row, status: 'complete' });
      // Brain emits from the hangup finalizer (and a mid-call visit persist can emit earlier).
      s.onEvent(hd8a8aEvent(), { replaces: false });
      await c.advance(29 * 1000);
      assert.equal(hits.sms, 0, 'settles ~30 s before sending');
      await c.advance(2 * 1000);
      assert.equal(hits.sms, 1, 'exactly one owner SMS');
      const body = hits.bodies[0];
      assert.match(body, /^Enquiry - Aris Kenya/);
      assert.doesNotMatch(body, /missed-call lead/i);
      assert.match(body, /Interested in 10 x Protractor .*not confirmed/);
      assert.doesNotMatch(body, /Order:/);
      // Single unit charge: one reserve, held units = segments, settled sent.
      const reserves = ledgerDb.state.calls.filter((x) => x.op === 'reserve');
      assert.equal(reserves.length, 1);
      assert.equal(reserves[0].kind, 'call_summary');
      assert.equal(ledgerDb.state.used, 40 + reserves[0].units);
      assert.equal(reserves[0].units, 2, 'this body is 2 GSM-7 segments');
      assert.equal(ledgerDb.state.consumed, 0, 'no legacy consume on top of the reserve');
      assert.deepEqual(ledgerDb.state.calls.filter((x) => x.op === 'settle').map((x) => x.status), ['sent']);
      const marker = db.calls.merged.find((p) => p.owner_summary_sent_at);
      assert.equal(marker.owner_notify_kind, 'call_summary');
      assert.equal(marker.owner_summary_outcome, 'info_only');
      // Re-emit (hangup replaces, or Brain re-derives): Desk copy only.
      assert.equal(s.onEvent(hd8a8aEvent({ now: new Date('2026-10-19T10:16:00Z') }), { replaces: true }).action, 'desk_only');
      await c.advance(10 * 60 * 1000);
      assert.equal(hits.sms, 1, 'no resend');
      assert.equal(ledgerDb.state.used, 40 + reserves[0].units, 'still one charge');
    } finally {
      restore();
    }
  });

  it('a second sender instance (restart) does not resend: durable marker and ledger key', async () => {
    const ledgerDb = fakeLedgerDb();
    const restore = stubDb(ledgerDb);
    const hits = mockTextSms();
    try {
      const c = clock();
      const db = callDb();
      const a = makeSender(db, c);
      await a.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
      a.onEvent(hd8a8aEvent());
      await c.advance(31 * 1000);
      assert.equal(hits.sms, 1);
      const b = makeSender(db, c);
      await b.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
      b.onEvent(hd8a8aEvent(), { replaces: true });
      await c.advance(5 * 60 * 1000);
      assert.equal(hits.sms, 1);
    } finally {
      restore();
    }
  });

  it('a re-emit before the settle ends sends the latest copy, once', async () => {
    const c = clock();
    const db = callDb();
    const out = [];
    const s = makeSender(db, c, { sendToPerson: async (o) => { out.push(o.body); return { channel: 'sms', to: o.person.phone }; } });
    // Mid-call emit (visit write) before the call ended, then the hangup re-emit.
    s.onEvent(hd8a8aEvent());
    await c.advance(60 * 1000);
    assert.equal(out.length, 0, 'waits for the call end');
    await s.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
    const later = hd8a8aEvent({
      receipts: [{
        receiptId: 'v1_1', type: 'order', status: 'confirmed', writtenRowId: 'sr_9',
        slots: { pickup: { status: 'not_given' }, name: { value: 'Alvin Yegon', status: 'given' } },
        items: [{ catalogueId: 'p360', name: '360 degrees protractor', qty: { value: 10, status: 'given' }, unitPrice: { min: 50, max: 50, unit: 'each' }, stock: 'unconfirmed' }],
      }],
    });
    s.onEvent(later, { replaces: true });
    await c.advance(31 * 1000);
    assert.equal(out.length, 1);
    assert.match(out[0], /^Order - Aris Kenya/);
    assert.match(out[0], /Order: 10 x 360 degrees protractor \(KSh 50 each, stock to confirm\)/);
  });

  it('urgent (escalation receipt) sends as soon as the call end is known, still once', async () => {
    const c = clock();
    const db = callDb();
    const out = [];
    const s = makeSender(db, c, { sendToPerson: async (o) => { out.push(o.body); return { channel: 'sms', to: o.person.phone }; } });
    const urgent = E.buildCallSummaryEvent({
      path: 'v2', callLanguage: 'en', callId: CALL.id, tenantId: 'ten_aris', answered: true,
      caller: { name: 'Alvin Yegon', phone: '+254790381872' },
      receipts: [{ receiptId: 'r1', type: 'escalation', status: 'confirmed', slots: { reason: { value: 'wants the manager about a refund', status: 'given' }, name: { value: 'Alvin Yegon', status: 'given' } } }],
    }).event;
    assert.equal(urgent.urgent, true);
    await s.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
    s.onEvent(urgent);
    await c.advance(0);
    assert.equal(out.length, 1, 'no 30 s settle');
    assert.match(out[0], /^URGENT: wants the manager about a refund - Aris Kenya/);
    assert.match(out[0], /Manager requested: wants the manager about a refund\./);
    s.onEvent(urgent, { replaces: true });
    await c.advance(5 * 60 * 1000);
    assert.equal(out.length, 1);
  });

  it('fallback: never-answered call gets "Missed call from X" at 2 min; a late event does not resend', async () => {
    const c = clock();
    const db = callDb({ ...CALL, status: 'no_answer', name: null, reason: null });
    const out = [];
    const s = makeSender(db, c, { sendToPerson: async (o) => { out.push(o.body); return { channel: 'sms', to: o.person.phone }; } });
    await s.noteCallEnded({ callSid: CALL.call_sid, status: 'no_answer' });
    await c.advance(119 * 1000);
    assert.equal(out.length, 0);
    await c.advance(2 * 1000);
    assert.equal(out.length, 1);
    assert.match(out[0], /^Missed call from \+254790381872 - Aris Kenya/);
    assert.equal(s.onEvent(hd8a8aEvent()).action, 'desk_only');
    await c.advance(60 * 1000);
    assert.equal(out.length, 1);
    assert.equal(db.calls.merged.find((p) => p.owner_summary_sent_at).owner_summary_mode, 'fallback');
  });

  it('fallback: answered call with no event gets "Call from X, no details captured"', async () => {
    const c = clock();
    const db = callDb();
    const out = [];
    const s = makeSender(db, c, { sendToPerson: async (o) => { out.push(o.body); return { channel: 'sms', to: o.person.phone }; } });
    await s.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
    await s.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' }); // second webhook
    await c.advance(2 * 60 * 1000 + 1);
    assert.equal(out.length, 1);
    assert.match(out[0], /^Call from Alvin Yegon \(\+254790381872\), no details captured - Aris Kenya/);
    assert.doesNotMatch(out[0], /missed/i);
  });

  it('one message per person to every inbox recipient (two staff), not per tool', async () => {
    const c = clock();
    const db = callDb(CALL, {
      ...PROFILE,
      teamDirectory: [
        { id: 'p1', name: 'Shop', phone: '+254790381872', receives_inbox: true },
        { id: 'p2', name: 'Manager', phone: '+254711002419', receives_inbox: true },
      ],
    });
    const out = [];
    const s = makeSender(db, c, { sendToPerson: async (o) => { out.push(o); return { channel: 'sms', to: o.person.phone }; } });
    await s.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
    s.onEvent(hd8a8aEvent());
    await c.advance(31 * 1000);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((o) => o.person.phone).sort(), ['+254711002419', '+254790381872']);
    assert.ok(out.every((o) => o.ledger.kind === 'call_summary' && o.ledger.callSid === CALL.call_sid));
  });
});

describe('owner call summary: channel order', () => {
  beforeEach(setEnv);
  afterEach(restoreEnv);

  it('WhatsApp first when the 24 h window is open, then SMS / email on failure', async () => {
    process.env.SAUTIKIT_API_KEY = 'test';
    process.env.SAUTIKIT_WHATSAPP_NUMBER_ID = 'wa_1';
    const calls = [];
    const dispatch = async (o) => {
      calls.push(o.channels);
      return o.channels.whatsapp ? { channel: null, reason: 'send_failed' } : { channel: 'sms', to: o.to };
    };
    const person = { phone: '+254711000001', email: 'o@x.co' };
    const r = await sendOwnerSummaryToPerson({ person, body: 'b', ledger: {}, dispatch, windowOpen: async () => true });
    assert.equal(r.channel, 'sms');
    assert.deepEqual(calls, [
      { sms: false, whatsapp: true, email: false },
      { sms: true, whatsapp: false, email: true },
    ]);
    calls.length = 0;
    await sendOwnerSummaryToPerson({ person, body: 'b', ledger: {}, dispatch, windowOpen: async () => false });
    assert.deepEqual(calls, [{ sms: true, whatsapp: false, email: true }], 'closed window: no WhatsApp template');
    calls.length = 0;
    const dup = async (o) => { calls.push(o.channels); return { channel: null, reason: 'instance_already_sent' }; };
    await sendOwnerSummaryToPerson({ person, body: 'b', ledger: {}, dispatch: dup, windowOpen: async () => true });
    assert.equal(calls.length, 1, 'already sent: no second channel');
  });
});

describe('SMS metering: claim after accept, compensate on ledger failure', () => {
  const ledger = { tenantId: 't1', callSid: 'HD_8a8aa14db292', callId: 'c1', kind: 'call_summary' };
  beforeEach(() => {
    setEnv();
    resetInstanceFlights();
  });
  afterEach(() => {
    mock.restoreAll();
    resetInstanceFlights();
    restoreEnv();
  });

  function legacyDb({ insert = [{ ok: true, id: 'n1' }], usage } = {}) {
    const order = [];
    const state = { consumed: 0, inserts: 0 };
    return {
      order,
      state,
      findNotifySend: async () => null,
      getTenantSmsUsage: async () => usage || { smsIncluded: 200, smsUsed: 10, onDemand: false, enforcement: 'off' },
      consumeSmsUnits: async () => {
        order.push('consume');
        state.consumed += 1;
        return { allowed: true, reason: 'beta', overage: false };
      },
      insertNotifySend: async () => {
        order.push('insert');
        const r = insert[Math.min(state.inserts, insert.length - 1)];
        state.inserts += 1;
        return r;
      },
    };
  }

  it('legacy path: provider accept, then ledger row, then units (one claim)', async () => {
    const db = legacyDb();
    const restore = stubDb(db);
    const hits = mockTextSms();
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const r = await dispatchAlert({ to: '+254711000000', body: 'Enquiry - Aris', ledger: { ...ledger } });
      assert.equal(r.channel, 'sms');
      assert.equal(hits.sms, 1);
      assert.deepEqual(db.order, ['insert', 'consume']);
    } finally {
      restore();
    }
  });

  it('legacy path: a provider failure claims nothing', async () => {
    const db = legacyDb();
    const restore = stubDb(db);
    mockTextSms({ ok: false });
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const r = await dispatchAlert({ to: '+254711000000', body: 'Enquiry - Aris', ledger: { ...ledger }, channels: { sms: true, whatsapp: false, email: false } });
      assert.equal(r.channel, null);
      assert.equal(db.state.consumed, 0);
      assert.equal(db.state.inserts, 0);
    } finally {
      restore();
    }
  });

  it('legacy path: ledger write fails twice => units never claimed and a resend is blocked', async () => {
    const db = legacyDb({ insert: [{ ok: false, reason: 'insert_failed' }] });
    const restore = stubDb(db);
    const hits = mockTextSms();
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const r = await dispatchAlert({ to: '+254711000000', body: 'Enquiry - Aris', ledger: { ...ledger } });
      assert.equal(r.channel, null);
      assert.equal(r.reason, 'ledger_unrecorded');
      assert.equal(hits.sms, 1);
      assert.equal(db.state.inserts, 2, 'one retry');
      assert.equal(db.state.consumed, 0, 'compensated: no units claimed for an unrecorded send');
      const again = await dispatchAlert({ to: '+254711000000', body: 'Enquiry - Aris', ledger: { ...ledger } });
      assert.equal(again.reason, 'instance_already_sent');
      assert.equal(hits.sms, 1, 'no second SMS');
      assert.equal(db.state.consumed, 0, 'never double-charged');
    } finally {
      restore();
    }
  });

  it('legacy path: the cap still stops a send before the provider (precheck is read-only)', async () => {
    const db = legacyDb({ usage: { smsIncluded: 10, smsUsed: 10, onDemand: false, enforcement: 'soft' } });
    const restore = stubDb(db);
    const hits = mockTextSms();
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const r = await dispatchAlert({ to: '+254711000000', body: 'x', ledger: { ...ledger }, channels: { sms: true, whatsapp: false, email: false } });
      assert.equal(r.channel, null);
      assert.equal(hits.sms, 0);
      assert.equal(db.state.consumed, 0);
    } finally {
      restore();
    }
  });

  it('legacy path: beta (billing_enforcement off) past the cap still sends and only meters', async () => {
    const db = legacyDb({ usage: { smsIncluded: 10, smsUsed: 50, onDemand: false, enforcement: 'off' } });
    const restore = stubDb(db);
    const hits = mockTextSms();
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const r = await dispatchAlert({ to: '+254711000000', body: 'x', ledger: { ...ledger } });
      assert.equal(r.channel, 'sms');
      assert.equal(hits.sms, 1);
      assert.equal(db.state.consumed, 1);
    } finally {
      restore();
    }
  });

  it('reserve path: a failed settle is retried once; units held once', async () => {
    const db = fakeLedgerDb({ settleFailures: 1 });
    const restore = stubDb(db);
    const hits = mockTextSms();
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const r = await dispatchAlert({ to: '+254711000000', body: 'x', ledger: { ...ledger } });
      assert.equal(r.channel, 'sms');
      assert.equal(hits.sms, 1);
      assert.equal(db.state.calls.filter((x) => x.op === 'settle').length, 2);
      assert.equal(db.state.used, 1);
      assert.equal([...db.rows.values()][0].status, 'sent');
    } finally {
      restore();
    }
  });
});

// B2 follow-up (#1010): BA v2 adds outcomes brain_error (brain failed mid-call,
// callback row saved) and write_failed (the save itself failed).
describe('owner call summary: brain_error / write_failed (#1010)', () => {
  function failureEvent(outcome, extra = {}) {
    return {
      event: 'call.summary.ready', schemaVersion: 1, path: 'v2', callLanguage: 'en', callId: CALL.id, tenantId: 'ten_aris',
      outcome, urgent: false,
      caller: { name: 'Alvin Yegon', phone: '+254790381872' },
      receipts: [{
        receiptId: 'r1', type: 'callback', status: 'unconfirmed',
        ...(outcome === 'brain_error' ? { writtenRowId: 'sr_77' } : {}),
        brainError: { kind: 'model', saved: outcome === 'brain_error' },
        slots: { reason: { value: 'deep clean on Friday', status: 'given' }, name: { value: 'Alvin Yegon', status: 'given' } },
      }],
      emittedAt: '2026-10-28T10:00:00Z',
      ...extra,
    };
  }
  function bookedEvent() {
    return {
      event: 'call.summary.ready', schemaVersion: 1, path: 'v2', callLanguage: 'en', callId: CALL.id, tenantId: 'ten_aris',
      outcome: 'booked', urgent: false,
      caller: { name: 'Alvin Yegon', phone: '+254790381872' },
      receipts: [{ receiptId: 'r1', type: 'booking', status: 'confirmed', writtenRowId: 'a1', slots: { service: { value: 'Deep clean', status: 'given' }, when: { value: 'Friday 10am', status: 'given' }, place: { value: 'Kilimani', status: 'given' } } }],
      emittedAt: '2026-10-28T09:59:00Z',
    };
  }

  it('EN: both render as "Call back needed", never "Enquiry"; write_failed says the request was not saved', () => {
    const be = renderOwnerSummary(failureEvent('brain_error'), { businessName: 'Aris Kenya' });
    assert.match(be.label, /^Call back needed/);
    assert.match(be.subject, /^Call back needed/);
    assert.match(be.text, /^Call back needed: the line had a problem - Aris Kenya$/m);
    assert.match(be.text, /A callback request was saved\. Please call the caller back\./);
    assert.doesNotMatch(be.text, /Enquiry|asked questions/);
    const wf = renderOwnerSummary(failureEvent('write_failed'), {});
    assert.match(wf.label, /^Call back needed/);
    assert.match(wf.text, /^Call back needed: request NOT saved$/m);
    assert.match(wf.text, /could not save this request\. Please call the caller back\./);
    assert.doesNotMatch(wf.text, /Enquiry|asked questions/);
    for (const t of [be.text, wf.text]) assert.match(t, /^[\x20-\x7e\n]+$/, 'GSM-7 safe');
  });

  it('SW: Swahili labels from the brain-side summary, never "Ulizo"', () => {
    for (const o of ['brain_error', 'write_failed']) {
      const r = renderOwnerSummary(failureEvent(o, { callLanguage: 'sw' }), {});
      assert.match(r.label, /^Mpigie tena/);
      assert.equal(r.language, 'sw');
      assert.doesNotMatch(r.text, /Ulizo|aliuliza maswali/);
      assert.match(r.text, /Tafadhali mpigie mpigaji\./);
    }
  });

  it('no receipts: still "Call back needed", no "asked questions" line', () => {
    for (const o of ['brain_error', 'write_failed']) {
      const r = renderOwnerSummary(failureEvent(o, { receipts: [] }), {});
      assert.match(r.label, /^Call back needed/);
      assert.doesNotMatch(r.text, /asked questions|Enquiry/);
    }
  });

  it('precedence: a brain error stays over an earlier or later booked copy; escalated / missed still outrank', () => {
    assert.equal(withStickyFailure(bookedEvent(), failureEvent('brain_error')).outcome, 'brain_error');
    assert.equal(withStickyFailure(failureEvent('brain_error'), bookedEvent()).outcome, 'brain_error');
    assert.equal(withStickyFailure(failureEvent('write_failed'), { ...bookedEvent(), outcome: 'info_only' }).outcome, 'write_failed');
    assert.equal(withStickyFailure(failureEvent('write_failed'), failureEvent('brain_error')).outcome, 'brain_error');
    assert.equal(withStickyFailure(failureEvent('brain_error'), { ...bookedEvent(), outcome: 'escalated', urgent: true }).outcome, 'escalated');
    assert.equal(withStickyFailure(null, bookedEvent()).outcome, 'booked');
  });

  it('sender: confirmed booking emitted first, then brain_error before the settle: one message, "Call back needed"', async () => {
    setEnv();
    try {
      const c = clock();
      const db = callDb();
      const out = [];
      const s = makeSender(db, c, { sendToPerson: async (o) => { out.push(o); return { channel: 'sms', to: o.person.phone }; } });
      s.onEvent(bookedEvent());
      await s.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
      s.onEvent(failureEvent('brain_error'), { replaces: true });
      await c.advance(31 * 1000);
      assert.equal(out.length, 1, 'one summary per call');
      assert.match(out[0].body, /^Call back needed: the line had a problem - Aris Kenya/);
      assert.equal(out[0].lead.reason, 'Call back needed: the line had a problem');
      assert.equal(out[0].alertType, 'other_calls', 'same owner alert type as callback_needed');
      const marker = db.calls.merged.find((p) => p.owner_summary_sent_at);
      assert.equal(marker.owner_summary_outcome, 'brain_error');
      // A later re-emit (even booked-only) is Desk copy only: no second send.
      assert.equal(s.onEvent(bookedEvent(), { replaces: true }).action, 'desk_only');
      await c.advance(10 * 60 * 1000);
      assert.equal(out.length, 1);
    } finally {
      restoreEnv();
    }
  });

  it('sender: write_failed then a booked-only re-emit before the settle keeps write_failed', async () => {
    setEnv();
    try {
      const c = clock();
      const db = callDb();
      const out = [];
      const s = makeSender(db, c, { sendToPerson: async (o) => { out.push(o.body); return { channel: 'sms', to: o.person.phone }; } });
      await s.noteCallEnded({ callSid: CALL.call_sid, status: 'complete' });
      s.onEvent(failureEvent('write_failed'));
      s.onEvent(bookedEvent(), { replaces: true });
      await c.advance(31 * 1000);
      assert.equal(out.length, 1);
      assert.match(out[0], /^Call back needed: request NOT saved/);
      assert.doesNotMatch(out[0], /^Booking - /m);
    } finally {
      restoreEnv();
    }
  });
});
