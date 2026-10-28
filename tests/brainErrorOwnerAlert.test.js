'use strict';
// B2 follow-up (#1010), Platform's question: what happens to brain_error / write_failed follow-ups when
// OWNER_SUMMARY_SUPPRESS_LEGACY is on (the per-request SMS folds into the end-of-call summary)?
//   (1) suppress + CALL_SUMMARY_EVENT + OWNER_CALL_SUMMARY on: no separate per-request SMS; the one end-of-call summary
//       goes out, labelled "Call back needed", with the callback receipt.
//   (2) suppress on but the summary flags off: the owner still gets an alert. A saved row keeps its per-request alert
//       (suppression needs the sender); NOTHING saved gets one direct owner alert (brainErrorAlert.js). Never silent.
// EN + SW. Stand-in models only (GEMINI keys unset), synthetic numbers, SMS provider faked (no network).
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY; delete process.env.BRAIN_SAFE_MODE;
const BE = require('../src/conversation/v2/brainEngines');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { runOwnedTurn, repairLine } = require('../src/conversation/v2/ownsCall');
const { finishCall } = require('../src/conversation/v2/machine');
const CSE = require('../src/conversation/callSummaryEvent');
const { createOwnerSummarySender, legacyOwnerSendsSuppressed } = require('../src/notifications/ownerCallSummary');
const { brainErrorAlertPlan, createBrainErrorAlerter, TITLE } = require('../src/notifications/brainErrorAlert');
const { staffRecipients } = require('../src/conversation/teamPermissions');
const { resetInstanceFlights } = require('../src/notifications/sendLedger');
const FR = require('./fixtures/dndSimTenant.json');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const inner = FR.picks.picks;
const DND = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows: inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version })) }), id: FR.row.id };
const DD = { ...DD0, id: DD0.tenantId };
const PHONE = '+254700000009'; // synthetic caller
const OWNER = '+254711000009'; // synthetic owner
const ACTION = { appointment: 'create_appointment', serviceRequest: 'create_service_request' };
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const FLAGS = ['OWNER_SUMMARY_SUPPRESS_LEGACY', 'CALL_SUMMARY_EVENT', 'OWNER_CALL_SUMMARY', 'TEXTSMS_API_KEY', 'TEXTSMS_PARTNER_ID', 'TEXTSMS_SHORTCODE', 'SAUTIKIT_API_KEY', 'SAUTIKIT_WHATSAPP_NUMBER_ID', 'RESEND_API_KEY', 'ALERT_EMAIL_FROM', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
let saved = {};
function setEnv(on) {
  saved = {};
  for (const k of FLAGS) saved[k] = process.env[k];
  const env = { TEXTSMS_API_KEY: 'sim-not-a-key', TEXTSMS_PARTNER_ID: '1', TEXTSMS_SHORTCODE: 'SCALERS', OWNER_SUMMARY_SUPPRESS_LEGACY: 'on', ...on };
  for (const k of FLAGS) { if (env[k]) process.env[k] = env[k]; else delete process.env[k]; }
}
function restoreEnv() { for (const k of FLAGS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }

function standIn(us) {
  let i = 0;
  return () => async ({ request }) => {
    if (request.generationConfig?.responseSchema?.properties?.intent) {
      const u = us[Math.min(i++, us.length - 1)];
      if (u) return { text: JSON.stringify({ answers: [], slots: {}, yes_no: null, wants_human: false, closing: false, ...u }) };
    }
    throw Object.assign(new Error('gemini http 503'), { code: 'http_503' });
  };
}
function throwOnTurns(turns) {
  const real = BE.runBrainEnginesTurn; let n = 0;
  BE.runBrainEnginesTurn = async (...a) => { n += 1; if (turns.includes(n)) throw new Error('gemini stream reset mid-turn'); return real(...a); };
  return () => { BE.runBrainEnginesTurn = real; };
}

/** One call through the real live entry; returns what the owner-alert layer sees. */
async function brainErrorCall({ lang, failSave = false, callbackThrow = false }) {
  const recs = []; const rows = [];
  const us = callbackThrow ? [{ intent: 'callback', language: lang }, { intent: 'ask', slots: { name: 'Wanjiru' }, language: lang }, { intent: 'confirm', yes_no: 'yes', language: lang }] : [];
  const live = createBrainV2Live({
    env: {}, prewarm: false, log: () => {}, now: () => new Date('2026-10-14T05:00:00Z'), callSid: CALL.call_sid,
    callerFile: { callerPhone: PHONE, openRows: [] }, modelLeadStreamFor: standIn(us),
    onBrainError: (rec) => recs.push(rec),
    applyTools: async (a) => {
      const k = Object.keys(a)[0];
      if (k === 'serviceRequest' && (failSave || callbackThrow)) throw new Error('supabase insert failed');
      if (k === 'serviceRequest') rows.push(a.serviceRequest);
      return { results: [{ action: ACTION[k] || k, status: 'succeeded', id: `row_${rows.length || 1}` }] };
    },
  });
  const said = [];
  if (callbackThrow) {
    for (const t of lang === 'sw' ? ['Naomba mtu anipigie', 'Jina langu ni Wanjiru', 'Ndio'] : ['Can someone call me back?', 'My name is Wanjiru', 'Yes']) said.push((await runOwnedTurn(live, { text: t, profile: DND, langLock: lang })).line);
  } else {
    const restore = throwOnTurns([2]);
    try {
      said.push((await runOwnedTurn(live, { text: lang === 'sw' ? 'Nataka kusafisha sofa' : 'Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', profile: DD, langLock: lang })).line);
      said.push((await runOwnedTurn(live, { text: lang === 'sw' ? 'Ndio' : 'Yes', profile: DD, langLock: lang })).line);
    } finally { restore(); }
  }
  const profile = callbackThrow ? DND : DD;
  const fin = finishCall(live.getState(), { businessName: 'Test', callerPhone: PHONE, profile });
  return { recs, rows, said, fin, profile };
}

const CALL = { id: 'c0b2e000-0000-4000-8000-00000000b2e1', tenant_id: 'ten_b2', call_sid: 'HD_b2_owner_alert', from_number: PHONE, name: null, status: 'complete', summary: '{}' };
const PROFILE = { id: 'ten_b2', businessName: 'Done and Dusted', whatsappNumber: OWNER, alertEmail: null, notifyChannels: null, teamDirectory: [] };
function callDb() {
  const row = { ...CALL };
  return {
    row,
    getCall: async () => ({ ...row }),
    getTenantProfile: async () => ({ ...PROFILE }),
    markWhatsappSent: async () => {},
    mergeCallSummaryMeta: async ({ patch }) => { row.summary = JSON.stringify({ ...JSON.parse(row.summary || '{}'), ...patch }); },
  };
}
function ledgerDb() {
  const rows = new Map(); let seq = 0;
  return {
    findNotifySend: async () => null,
    consumeSmsUnits: async () => ({ allowed: true, reason: 'beta', overage: false }),
    insertNotifySend: async () => ({ ok: true, id: 'legacy' }),
    reserveNotifySend: async (p) => { const id = `n${++seq}`; rows.set(id, p); return { ok: true, id, allowed: true, replayed: false, reason: 'included' }; },
    settleNotifySend: async ({ status }) => ({ ok: true, status }),
  };
}
function stubDb(exports) {
  const dbPath = require.resolve('../src/db');
  const prev = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports };
  return () => { if (prev) require.cache[dbPath] = prev; else delete require.cache[dbPath]; };
}
function mockTextSms() {
  const hits = { sms: 0, bodies: [] };
  mock.method(global, 'fetch', async (url, init) => {
    hits.sms += 1;
    try { hits.bodies.push(JSON.parse(init?.body || '{}').message || ''); } catch { hits.bodies.push(''); }
    return { ok: true, status: 200, text: async () => JSON.stringify({ responses: [{ 'respose-code': 200, 'response-description': 'Success', messageid: 77 }] }), json: async () => ({}) };
  });
  return hits;
}
function clock(start = Date.parse('2026-10-14T05:10:00Z')) {
  let t = start; const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + Math.max(0, ms), done: false }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.done = true; },
    async advance(ms) {
      const until = t + ms;
      for (;;) {
        const due = timers.filter((h) => !h.done && h.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at; due.done = true; await due.fn(); await new Promise((r) => setImmediate(r));
      }
      t = until; await new Promise((r) => setImmediate(r));
    },
  };
}
function fakeDispatch() {
  const calls = [];
  return { calls, dispatchToStaff: async (args) => { calls.push(args); return { sent: [{ channel: 'sms', to: OWNER }], errors: [] }; } };
}
function eventFor(fin, lang) {
  const built = CSE.buildCallSummaryEvent({ path: 'v2', callLanguage: lang, callId: CALL.id, tenantId: CALL.tenant_id, answered: true, caller: { phone: PHONE }, receipts: fin.summaryReceipts, failure: fin.outcome });
  assert.ok(built.ok, built.errors.join('; '));
  return built.event;
}

// The per-request alert on a saved row (server.js maybeSendServiceRequestNotification) is gated ONLY by
// legacyOwnerSendsSuppressed(), which needs the summary sender on. Pin that wiring.
function assertRequestAlertGate() {
  const body = SERVER.slice(SERVER.indexOf('async function maybeSendServiceRequestNotification'), SERVER.indexOf('async function maybeSendServiceRequestNotification') + 4000);
  assert.match(body, /const suppressStaff = ownerCallSummary\.legacyOwnerSendsSuppressed\(\);/);
  assert.match(body, /suppressStaff\s*\?\s*\{ sent: \[\], errors: \[\] \}\s*:\s*await dispatchToStaff\(/);
  assert.match(SERVER, /void alertBrainError\(callKey, rec\)/, 'the brain-error hook reaches the owner alerter');
}

describe('OWNER_SUMMARY_SUPPRESS_LEGACY on + CALL_SUMMARY_EVENT + OWNER_CALL_SUMMARY on', () => {
  beforeEach(() => { setEnv({ CALL_SUMMARY_EVENT: 'on', OWNER_CALL_SUMMARY: 'on' }); resetInstanceFlights(); });
  afterEach(() => { mock.restoreAll(); resetInstanceFlights(); restoreEnv(); });

  for (const lang of ['en', 'sw']) {
    it(`(1) ${lang.toUpperCase()} brain_error: no separate per-request SMS; one end-of-call summary "Call back needed" with the callback receipt`, async () => {
      assertRequestAlertGate();
      const c = await brainErrorCall({ lang });
      assert.equal(c.said[1], repairLine(lang));
      assert.equal(c.rows.length, 1, 'the follow-up row is saved');
      assert.equal(c.fin.outcome, 'brain_error');
      // no per-request SMS: the saved row's staff send is suppressed (folds into the summary) ...
      assert.equal(legacyOwnerSendsSuppressed(), true);
      assert.equal(brainErrorAlertPlan({ saved: true }).via, 'summary');
      // ... and the brain-error alerter sends nothing either
      const d = fakeDispatch();
      const alert = createBrainErrorAlerter({ db: callDb(), dispatchToStaff: d.dispatchToStaff, staffRecipients, log: { log() {}, warn() {} } });
      for (const rec of c.recs) assert.equal((await alert(CALL.call_sid, rec)).via, 'summary');
      assert.equal(d.calls.length, 0);
      // the one end-of-call summary
      const restore = stubDb(ledgerDb());
      const hits = mockTextSms();
      try {
        const ck = clock(); const db = callDb();
        const s = createOwnerSummarySender({ db, callDeskUrl: () => null, now: ck.now, setTimer: ck.setTimer, clearTimer: ck.clearTimer, log: { log() {}, warn() {} } });
        await s.noteCallEnded({ callSid: CALL.call_sid, call: db.row, status: 'complete' });
        s.onEvent(eventFor(c.fin, lang), { replaces: false });
        await ck.advance(31 * 1000);
        assert.equal(hits.sms, 1, 'exactly one owner SMS for the call');
        const body = hits.bodies[0];
        if (lang === 'en') {
          assert.match(body, /^Call back needed: the line had a problem - Done and Dusted/);
          assert.match(body, /Asked for a callback/);
        } else {
          assert.match(body, /^Mpigie tena: laini ilikuwa na hitilafu - Done and Dusted/);
        }
        assert.match(body, /Live line could not complete\. Team to follow up\./);
        assert.match(body, /700 ?000 ?009|254700000009/, 'the caller number');
        assert.match(JSON.parse(db.row.summary).owner_summary_outcome, /^brain_error$/);
      } finally { restore(); }
    });
  }

  it('(1) EN+SW write_failed (the save itself failed): still no direct alert; the summary says "request NOT saved"', async () => {
    for (const lang of ['en', 'sw']) {
      const c = await brainErrorCall({ lang, failSave: true });
      assert.equal(c.rows.length, 0);
      assert.equal(c.fin.outcome, 'write_failed');
      const d = fakeDispatch();
      const alert = createBrainErrorAlerter({ db: callDb(), dispatchToStaff: d.dispatchToStaff, staffRecipients, log: { log() {}, warn() {} } });
      assert.equal((await alert(CALL.call_sid, c.recs[0])).via, 'summary');
      assert.equal(d.calls.length, 0, `${lang}: the summary carries it`);
      const ev = eventFor(c.fin, lang);
      assert.equal(ev.outcome, 'write_failed');
      assert.match(require('../src/notifications/ownerSummaryText').renderOwnerSummary(ev, { businessName: 'DD' }).text, lang === 'en' ? /^Call back needed: request NOT saved/ : /^Mpigie tena: ombi HALIKUHIFADHIWA/);
    }
  });
});

describe('OWNER_SUMMARY_SUPPRESS_LEGACY on, summary flags off: a brain error is never silent', () => {
  afterEach(() => { mock.restoreAll(); restoreEnv(); });
  const OFF = [{ name: 'both summary flags off', env: {} }, { name: 'OWNER_CALL_SUMMARY off', env: { CALL_SUMMARY_EVENT: 'on' } }, { name: 'CALL_SUMMARY_EVENT off', env: { OWNER_CALL_SUMMARY: 'on' } }];

  for (const v of OFF) {
    it(`(2) ${v.name}, EN+SW: a saved brain_error row keeps its per-request alert; no summary will be sent`, async () => {
      setEnv(v.env);
      assertRequestAlertGate();
      for (const lang of ['en', 'sw']) {
        const c = await brainErrorCall({ lang });
        assert.equal(c.rows.length, 1);
        assert.equal(legacyOwnerSendsSuppressed(), false, 'suppression needs the summary sender');
        assert.equal(brainErrorAlertPlan({ saved: true }).via, 'request_alert');
        const ck = clock();
        const s = createOwnerSummarySender({ db: callDb(), now: ck.now, setTimer: ck.setTimer, clearTimer: ck.clearTimer, log: { log() {}, warn() {} } });
        assert.equal(s.onEvent(eventFor(c.fin, lang)).action, 'disabled', 'no summary goes out');
      }
    });

    it(`(2) ${v.name}, EN+SW: NOTHING saved (save failed / failed write + fallback) -> one direct owner alert, once per call`, async () => {
      setEnv(v.env);
      for (const lang of ['en', 'sw']) {
        for (const mode of [{ failSave: true }, { callbackThrow: true }]) {
          const c = await brainErrorCall({ lang, ...mode });
          assert.equal(c.rows.length, 0);
          assert.equal(c.fin.outcome, 'write_failed');
          assert.ok(c.recs.length >= 1 && c.recs.every((r) => !r.ok), `${lang} ${JSON.stringify(mode)}: the hook reports the unsaved follow-up`);
          assert.ok(!c.said.some((l) => /\b(booked|nimeweka|atakupigia|watakupigia)\b/i.test(l)), 'never claims');
          const d = fakeDispatch();
          const alert = createBrainErrorAlerter({ db: callDb(), dispatchToStaff: d.dispatchToStaff, staffRecipients, log: { log() {}, warn() {} } });
          const first = await alert(CALL.call_sid, c.recs[0]);
          assert.equal(first.via, 'direct_alert');
          assert.equal(first.sent, true);
          for (const rec of c.recs) await alert(CALL.call_sid, rec);
          await alert(CALL.call_sid, { ok: false, kind: 'voice' });
          assert.equal(d.calls.length, 1, 'once per call');
          const a = d.calls[0];
          assert.match(a.body, new RegExp(TITLE));
          assert.match(a.body, /254700000009|0700 ?000 ?009/);
          assert.match(a.body, /could NOT save/);
          assert.equal(a.ledger.kind, 'brain_error');
          assert.ok(a.recipients.some((r) => r.phone === OWNER), 'to the owner');
        }
      }
    });
  }
});
