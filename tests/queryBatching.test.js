'use strict';

// VOICE_QUERY_BATCHING (N+1 audit 21 Oct 2026): query counts and serial vs
// parallel wall time on a fake Supabase that counts every round trip and adds
// LATENCY_MS to each. Flag off must keep today's reads; flag on must give the
// same profile / card / summary with fewer, parallel round trips.
// No network and no database: the Supabase client is replaced in require.cache.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://fake.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake';
delete process.env.TENANT_ID;

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./helpers/fakeSupabaseCounter');

const LATENCY_MS = Number(process.env.QB_TEST_LATENCY_MS || 40);
const TENANT = 'tenant-1';
const PHONE = '+254711000111';

function seedTables() {
  return {
    tenants: [
      {
        id: TENANT,
        business_name: 'Mama Njeri Salon',
        sautikit_virtual_number: '+254700000001',
        llm_system_prompt: 'Be kind.',
        whatsapp_notification_number: '+254722000222',
        alert_email: 'owner@example.com',
        notify_channels: { sms: true, whatsapp: true, email: false },
        agent_name: 'Wanjiru',
        spoken_name: 'Mama Njeri',
        greeting_invite: 'How can I help?',
        agent_tone: 'warm',
        business_hours: 'Mon-Sat 8-18',
        hours_schedule: null,
        after_hours_mode: 'serve',
        services_offered: 'Braids, weaves',
        services_catalog: [{ name: 'Braids', price: 1500 }],
        product_catalog: [],
        social_handles: {},
        faqs: [{ q: 'Parking?', a: 'Yes' }],
        team_directory: [{ name: 'Njeri', role: 'owner', phone: '+254722000222' }],
        unknown_answer_fallback: 'I will ask the owner.',
        daily_bulletin: [],
        agent_tools: { escalate: true, end_call: true },
        tts_lexicon: [],
        soniox_voice_id: 'v1',
        soniox_voice_label: 'Voice 1',
        vertical: 'salon',
        handoff_mode: 'callback',
        business_locations: [],
        business_policies: {},
        billing_enforcement: 'off',
        wallet_balance_kes: 100,
        is_active: true,
        archived_at: null,
        line_status: 'active',
        service_areas: { kilimani: { fee: 200 } },
        unknown_answer_spoken: { en: 'Let me check.', sw: 'Ngoja niulize.', source: 'I will ask the owner.' },
      },
      {
        id: 'tenant-2',
        business_name: 'Juma Hardware',
        agent_name: 'Baraka',
        is_active: true,
        services_catalog: [],
        vertical: 'retail',
      },
    ],
    appointments: [
      { id: 'a1', tenant_id: TENANT, status: 'requested', service_name: 'Braids', when_text: 'Friday 10am', created_at: '2026-10-20T07:00:00Z', caller_phone: PHONE, contact_id: 'c1' },
    ],
    tenant_field_meta: [
      { tenant_id: TENANT, field_path: 'services_catalog.braids', source: 'owner', confirmed_by: 'owner', confirmed_at: '2026-10-01T00:00:00Z', last_verified_at: null, stale_after_days: null, value_hash: 'h1' },
    ],
    contacts: [
      { id: 'c1', tenant_id: TENANT, name: 'Achieng', notes: 'Prefers mornings', last_reason: 'Braids', phone: PHONE, metadata: {} },
    ],
    service_requests: [
      { id: 'r1', tenant_id: TENANT, contact_id: 'c1', caller_phone: PHONE, request_type: 'hold', item: 'Hair oil', status: 'open', created_at: '2026-10-19T07:00:00Z' },
    ],
    calls: [],
    transcripts: [],
  };
}

function mergeCallSummaryRpc({ p_sid, p_patch }, tables) {
  // JS twin of supabase/migrations/20261021220000_merge_call_summary.sql.
  const row = (tables.calls || []).find((r) => r.sautikit_call_sid === p_sid);
  if (!row) return [];
  let base = {};
  const raw = row.summary;
  if (raw && String(raw).trim()) {
    try {
      const parsed = JSON.parse(raw);
      base = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { text: raw };
    } catch {
      base = { text: raw };
    }
  }
  const patch = p_patch || {};
  if (JSON.stringify(patch).includes('\\u0000')) {
    const err = new Error('unsupported Unicode escape sequence');
    err.code = '22P05';
    throw err;
  }
  // jsonb text output puts a space after ':' and ',' (Postgres jsonb_out).
  row.summary = jsonbText({ ...base, ...patch });
  return [{ ...row }];
}

function jsonbText(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${jsonbText(v)}`)
    .join(', ')}}`;
}

const RPCS = {
  tenant_hold_gate: () => ({ allowed: true, reasons: [] }),
};

let fake;
let db;
let callStart;
let callerMemory;

function loadFresh({ rpcs = RPCS, missingColumns = {}, hooks = {} } = {}) {
  fake = createFakeSupabase({ tables: seedTables(), latencyMs: LATENCY_MS, rpcs, missingColumns, hooks });
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: fake.client } };
  delete require.cache[require.resolve('../src/db')];
  db = require('../src/db');
  callStart = require('../src/speech/callStartLoad');
  callerMemory = require('../src/conversation/callerMemory');
}

function setFlag(on) {
  if (on) process.env.VOICE_QUERY_BATCHING = 'on';
  else delete process.env.VOICE_QUERY_BATCHING;
}

// The same inbound-calls shape server.js uses: the webhook's background
// upsertCall promise, keyed by sid, plus the tenant the directory resolved.
function inboundFor(callSid, rowPromise, tenantId = TENANT) {
  return {
    tenantIdFor: () => tenantId,
    awaitRow: () => rowPromise,
  };
}

function hydrate(profile, callSid, callRow = null) {
  return callerMemory.attachCallerMemory(profile, {
    callSid,
    getCall: (sid) => (callRow && callRow.from_number ? Promise.resolve(callRow) : db.getCallIdentity(sid)),
    getCallerMemory: (opts) => db.getCallerMemory(opts),
  });
}

/** server.js ensureTenantPrompt, flag off (verbatim order). */
async function callStartOff(callSid, inbound) {
  const inboundTenantId = inbound.tenantIdFor(callSid);
  await inbound.awaitRow(callSid, 2500);
  const profile = await db.getTenantProfile({ callSid, tenantId: inboundTenantId || undefined });
  await hydrate(profile, callSid);
  return profile;
}

async function callStartOn(callSid, inbound) {
  const { profile } = await callStart.loadCallStartProfile({
    callSid,
    inboundCalls: inbound,
    db,
    hydrateCallerMemory: hydrate,
  });
  return profile;
}

async function webhookRow(callSid) {
  return db.upsertCall({ callSid, fromNumber: PHONE, toNumber: '+254700000001', tenantId: TENANT });
}

async function measure(fn) {
  fake.reset();
  const t0 = Date.now();
  const value = await fn();
  return { value, queries: fake.count(), ms: Date.now() - t0, maxInFlight: fake.maxInFlight, log: fake.log.slice() };
}

const results = {};

describe('VOICE_QUERY_BATCHING call start (audit #1)', () => {
  before(() => {
    process.env.VOICE_AREA_FEES = 'on';
    process.env.VOICE_FACT_REFS = 'on';
  });
  after(() => {
    delete process.env.VOICE_AREA_FEES;
    delete process.env.VOICE_FACT_REFS;
    setFlag(false);
  });

  for (const scenario of ['contact_id', 'phone_fallback']) {
    it(`same profile and card, fewer round trips, parallel (${scenario})`, async () => {
      const prep = (tables) => {
        if (scenario === 'phone_fallback') {
          // Rows saved before the contact existed: every contact_id read is empty.
          for (const r of tables.appointments) delete r.contact_id;
          for (const r of tables.service_requests) delete r.contact_id;
        }
      };

      setFlag(false);
      loadFresh();
      prep(fake.tables);
      const rowOff = await webhookRow('CA-off');
      const off = await measure(() => callStartOff('CA-off', inboundFor('CA-off', Promise.resolve(rowOff))));

      setFlag(true);
      loadFresh({ rpcs: { ...RPCS } });
      prep(fake.tables);
      const rowOn = await webhookRow('CA-on');
      const on = await measure(() => callStartOn('CA-on', inboundFor('CA-on', Promise.resolve(rowOn))));

      assert.ok(off.value.callerMemory, 'off path loads the card');
      assert.deepEqual(on.value, off.value, 'profile + card identical');
      assert.ok(on.queries < off.queries, `queries on=${on.queries} off=${off.queries}`);
      assert.ok(on.ms < off.ms / 2, `wall on=${on.ms}ms off=${off.ms}ms`);
      // No getCall at call start, no separate service_areas / unknown_answer_spoken read.
      const getCalls = (r) => r.log.filter((e) => e.table === 'calls' && e.op === 'select').length;
      assert.equal(getCalls(on), 0);
      assert.equal(on.log.filter((e) => e.table === 'tenants').length, 1);
      // Critical path: tenant row ∥ visits ∥ field_meta ∥ hold gate ∥ (contact ->
      // card reads, each at most contact_id then phone): 3 round trips at most.
      assert.ok(on.ms <= LATENCY_MS * 3 + 60, `on wall ${on.ms}ms`);
      results[`call_start_${scenario}`] = {
        off: { queries: off.queries, ms: off.ms },
        on: { queries: on.queries, ms: on.ms, maxInFlight: on.maxInFlight },
      };
    });
  }

  it('new caller (no contact): one contact read, no card', async () => {
    setFlag(true);
    loadFresh();
    fake.tables.contacts = [];
    const row = await webhookRow('CA-new');
    const on = await measure(() => callStartOn('CA-new', inboundFor('CA-new', Promise.resolve(row))));
    assert.equal(on.value.callerMemory, undefined);
    assert.equal(on.queries, 5);
    assert.ok(on.ms <= LATENCY_MS + 60, `wall ${on.ms}`);
  });

  it('no webhook tenant: tenant from the call row, still no getCall', async () => {
    setFlag(true);
    loadFresh();
    const row = await webhookRow('CA-notenant');
    const on = await measure(() => callStartOn('CA-notenant', inboundFor('CA-notenant', Promise.resolve(row), null)));
    assert.equal(on.value.id, TENANT);
    assert.ok(on.value.callerMemory);
    assert.equal(on.log.filter((e) => e.table === 'calls').length, 0);
  });

  it('folded select fails on an old schema: falls back, same profile as off', async () => {
    setFlag(false);
    loadFresh({ missingColumns: { tenants: ['unknown_answer_spoken'] } });
    const off = await db.getTenantProfile({ tenantId: TENANT });
    setFlag(true);
    loadFresh({ missingColumns: { tenants: ['unknown_answer_spoken'] } });
    const on = await db.getTenantProfile({ tenantId: TENANT });
    assert.deepEqual(on, off);
    assert.equal(on.unknownAnswerSpoken, null);
  });

  it('service_areas rides an alias: profile.service_areas stays null like the off path', async () => {
    setFlag(false);
    loadFresh();
    const off = await db.getTenantProfile({ tenantId: TENANT });
    setFlag(true);
    loadFresh();
    const on = await db.getTenantProfile({ tenantId: TENANT });
    assert.equal(on.service_areas, null);
    assert.deepEqual(on.areaTerms, off.areaTerms, 'area terms still read from service_areas');
    assert.equal('qb_service_areas' in on, false);
  });

  it('unknown tenant: default profile, like the off path', async () => {
    setFlag(false);
    loadFresh();
    const off = await db.getTenantProfile({ tenantId: 'nope' });
    setFlag(true);
    loadFresh();
    const on = await db.getTenantProfile({ tenantId: 'nope' });
    assert.deepEqual(on, off);
  });
});

describe('VOICE_QUERY_BATCHING owner alerts (audit #2)', () => {
  it('light select has every owner-alert field the full profile gives', async () => {
    setFlag(false);
    loadFresh();
    await webhookRow('CA-alert');
    fake.reset();
    const full = await db.getTenantProfile({ callSid: 'CA-alert' });
    const offQueries = fake.count();
    setFlag(true);
    loadFresh();
    await webhookRow('CA-alert');
    fake.reset();
    const light = await db.getTenantNotifyFields({ callSid: 'CA-alert' });
    const onQueries = fake.count();
    for (const key of [
      'id', 'businessName', 'whatsappNumber', 'alertEmail', 'notifyChannels', 'teamDirectory',
      // escalation -> maybeQueueLiveTransfer / liveTransferReady
      'handoffMode', 'agentTools', 'hoursSchedule', 'billingEnforcement', 'walletBalanceKes', 'did',
    ]) {
      assert.deepEqual(light[key], full[key], key);
    }
    assert.equal(onQueries, 1, 'one tenants select (call id from the memo)');
    // getCall + tenant + visits + field_meta + hold_gate (+ service_areas and
    // unknown line when VOICE_AREA_FEES / VOICE_FACT_REFS are on).
    assert.ok(offQueries >= 5, `off ${offQueries}`);
    results.owner_alert_reload = { off: offQueries, on_no_session_profile: onQueries, on_session_profile: 0 };
  });

  it('missing column: full profile fallback', async () => {
    setFlag(true);
    loadFresh({ missingColumns: { tenants: ['notify_channels'] } });
    const p = await db.getTenantNotifyFields({ tenantId: TENANT });
    assert.equal(p.businessName, 'Mama Njeri Salon');
  });
});

describe('VOICE_QUERY_BATCHING call record (audit #3)', () => {
  /** One call's DB traffic on the call record: webhook row, call start, 5 summary merges, a name save, transcript flush, hangup summary id, 2 ledger ids. */
  async function lifecycle(callSid) {
    const row = await webhookRow(callSid);
    if (process.env.VOICE_QUERY_BATCHING) await callStartOn(callSid, inboundFor(callSid, Promise.resolve(row)));
    else await callStartOff(callSid, inboundFor(callSid, Promise.resolve(row)));
    for (let i = 0; i < 5; i += 1) {
      await db.mergeCallSummaryMeta({ callSid, patch: { [`k${i}`]: i, skip: undefined } });
    }
    await db.saveCallerInfo({ callSid, name: 'Achieng', reason: 'Braids' });
    await db.appendTranscript({ callSid, turns: [{ speaker: 'caller', text: 'Hi' }, { speaker: 'agent', text: 'Karibu' }] });
    await db.getCallIdentity(callSid); // writeHangupSummary call.id
    await db.getCallIdentity(callSid); // service-request ledger
    await db.getCallIdentity(callSid); // appointment ledger
    for (let i = 0; i < 3; i += 1) await db.getTenantNotifyFields({ callSid }); // owner alerts, no session profile
  }

  const getCallReads = () => fake.log.filter((e) => e.table === 'calls' && e.op === 'select').length;

  it('fewer getCall reads per call; summary identical', async () => {
    setFlag(false);
    loadFresh();
    fake.reset();
    // Off path owner alerts are full getTenantProfile reloads.
    const realNotify = db.getTenantNotifyFields;
    db.getTenantNotifyFields = (o) => db.getTenantProfile(o);
    await lifecycle('CA-life');
    db.getTenantNotifyFields = realNotify;
    const off = { total: fake.count(), getCall: getCallReads(), summary: JSON.parse(fake.tables.calls[0].summary) };

    setFlag(true);
    loadFresh({ rpcs: { ...RPCS, merge_call_summary: mergeCallSummaryRpc } });
    fake.reset();
    await lifecycle('CA-life');
    const on = { total: fake.count(), getCall: getCallReads(), summary: JSON.parse(fake.tables.calls[0].summary) };

    setFlag(true);
    loadFresh(); // merge_call_summary not applied yet
    fake.reset();
    await lifecycle('CA-life');
    const onNoRpc = { total: fake.count(), getCall: getCallReads(), summary: JSON.parse(fake.tables.calls[0].summary) };

    assert.deepEqual(on.summary, off.summary);
    assert.deepEqual(onNoRpc.summary, off.summary);
    // The one left is upsertCall's own existence read in the webhook.
    assert.equal(on.getCall, 1, 'only the webhook upsert reads calls.* with the RPC');
    assert.ok(onNoRpc.getCall < off.getCall, `no-rpc ${onNoRpc.getCall} < off ${off.getCall}`);
    assert.ok(on.total < off.total);
    results.call_lifecycle = { off, on_rpc: on, on_no_rpc: onNoRpc };
  });

  it('merge RPC: undefined keys untouched, null stored, unknown sid -> null', async () => {
    setFlag(true);
    loadFresh({ rpcs: { ...RPCS, merge_call_summary: mergeCallSummaryRpc } });
    await webhookRow('CA-m');
    await db.mergeCallSummaryMeta({ callSid: 'CA-m', patch: { a: 1, b: 'x' } });
    const out = await db.mergeCallSummaryMeta({ callSid: 'CA-m', patch: { a: undefined, b: null } });
    const meta = JSON.parse(out.summary);
    assert.equal(meta.a, 1);
    assert.equal(meta.b, null);
    assert.equal(meta.provider, 'sautikit');
    assert.equal(await db.mergeCallSummaryMeta({ callSid: 'CA-none', patch: { a: 1 } }), null);
    await assert.rejects(db.saveCallerInfo({ callSid: 'CA-none', name: 'X' }), /no call for CA-none/);
  });

  it('RPC missing: read-then-write fallback, re-probed at most once a minute', async () => {
    setFlag(true);
    loadFresh();
    await webhookRow('CA-p');
    fake.reset();
    for (let i = 0; i < 4; i += 1) await db.mergeCallSummaryMeta({ callSid: 'CA-p', patch: { i } });
    assert.equal(fake.count((e) => e.rpc === 'merge_call_summary'), 1);
    assert.equal(JSON.parse(fake.tables.calls[0].summary).i, 3);
  });

  it('flag off: no RPC, no memo', async () => {
    setFlag(false);
    loadFresh({ rpcs: { ...RPCS, merge_call_summary: mergeCallSummaryRpc } });
    await webhookRow('CA-o');
    fake.reset();
    await db.mergeCallSummaryMeta({ callSid: 'CA-o', patch: { a: 1 } });
    await db.getCallIdentity('CA-o');
    assert.equal(fake.count((e) => e.op === 'rpc'), 0);
    assert.equal(fake.count((e) => e.table === 'calls' && e.op === 'select'), 2);
  });
});

describe('VOICE_QUERY_BATCHING greeting warm (audit #4)', () => {
  const warm = () => require('../src/speech/greetingWarm');

  it('greeting fields from the light batch give the same greeting inputs', async () => {
    setFlag(true);
    loadFresh();
    const full = await db.getTenantProfile({ tenantId: TENANT });
    fake.reset();
    const batch = await db.listTenantGreetingProfiles([TENANT, 'tenant-2', TENANT]);
    assert.equal(fake.count(), 1);
    const at = new Date('2026-10-21T07:30:00Z');
    assert.deepEqual(warm().greetingInputs(batch.get(TENANT), { now: at }), warm().greetingInputs(full, { now: at }));
    for (const k of ['id', 'sonioxVoiceId', 'ttsLexicon', 'businessName', 'agentName']) {
      assert.deepEqual(batch.get(TENANT)[k], full[k], k);
    }
  });

  it('sweep: one query for all tenants; unchanged tenants skip; a change re-renders', async () => {
    setFlag(true);
    loadFresh();
    const { createGreetingWarmer } = warm();
    const cache = require('../src/speech/greetingPcmCache');
    const renders = [];
    let perTenantLoads = 0;
    const warmer = createGreetingWarmer({
      listTenantIds: async () => [TENANT, 'tenant-2'],
      getProfile: async (id) => {
        perTenantLoads += 1;
        return db.getTenantProfile({ tenantId: id });
      },
      getProfiles: (ids) => db.listTenantGreetingProfiles(ids),
      now: () => new Date('2026-10-21T07:30:00Z'),
      createSession: () => ({
        ready: Promise.resolve(),
        beginSpeak: async () => ({
          pushText: (t) => renders.push(t),
          end: async () => ({ pcm: Buffer.alloc(3200, 1) }),
        }),
        close() {},
      }),
    });
    if (!cache.isGreetingCacheEnabled()) return; // cache off in this env: nothing to warm
    fake.reset();
    await warmer.warmAll();
    const firstQueries = fake.count();
    const firstRenders = renders.length;
    assert.equal(firstQueries, 1);
    assert.equal(perTenantLoads, 0);
    assert.ok(firstRenders > 0);
    fake.reset();
    await warmer.warmAll();
    assert.equal(fake.count(), 1);
    assert.equal(renders.length, firstRenders, 'unchanged: no render');
    fake.tables.tenants[0].greeting_invite = 'Karibu, nikusaidie aje?';
    await warmer.warmAll();
    assert.ok(renders.length > firstRenders, 'changed greeting re-renders');
    results.greeting_warm = { per_sweep_queries_on: 1, per_sweep_queries_off_per_tenant: 'see getTenantProfile (5-7)' };
  });

  it('flag off (getProfiles -> null): per-tenant getProfile as before', async () => {
    const { createGreetingWarmer } = warm();
    let loads = 0;
    const warmer = createGreetingWarmer({
      listTenantIds: async () => ['a', 'b'],
      getProfile: async () => {
        loads += 1;
        return null;
      },
      getProfiles: () => null,
      createSession: () => ({}),
    });
    await warmer.warmAll();
    assert.equal(loads, 2);
  });
});

after(() => {
  if (process.env.QB_REPORT) {
    require('fs').writeFileSync(process.env.QB_REPORT, JSON.stringify({ latencyMs: LATENCY_MS, ...results }, null, 2));
  }
});

describe('VOICE_QUERY_BATCHING wiring and report', () => {
  const fs = require('fs');
  const path = require('path');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it('owner alerts go through ownerAlertProfile; the off path is the old reload', () => {
    assert.equal((server.match(/await ownerAlertProfile\(callSid\)/g) || []).length, 5);
    assert.equal((server.match(/db\.getTenantProfile\(\{ callSid \}\)/g) || []).length, 1, 'only inside ownerAlertProfile (flag off)');
    assert.match(server, /if \(!queryBatchingEnabled\(\)\) return db\.getTenantProfile\(\{ callSid \}\);/);
  });

  it('call start logs call_start_profile_ms with the flag state; off path kept verbatim', () => {
    assert.match(server, /call_start_profile_ms=\$\{Date\.now\(\) - profileLoadStartedAt\} batched=\$\{batching \? 1 : 0\}/);
    assert.match(server, /await inboundCalls\.awaitRow\(sessionCallSid, 2500\);\n\s+profile = await db\.getTenantProfile\(\{/);
  });

  it('report joins the two log lines by sid and splits by flag', () => {
    const { parseLines, report } = require('../scripts/call-start-latency-report');
    const log = [
      '[voice-timing][CA1] call_start_profile_ms=700 batched=0 card=1',
      '[voice-timing][CA1] connect_to_greeting_pcm_ms=980 cached=1',
      '[voice-timing][CA2] call_start_profile_ms=150 batched=1 card=1',
      '[voice-timing][CA2] connect_to_greeting_pcm_ms=420 cached=1',
      '[voice-timing][CA3] call_start_profile_ms=170 batched=1 card=0',
      '[voice-timing][CA3] connect_to_greeting_pcm_ms=520 cached=0',
    ].join('\n');
    const r = report(parseLines(log));
    assert.equal(r['batched=0'].connect_to_greeting_pcm_ms.p50, 980);
    assert.equal(r['batched=1'].calls, 2);
    assert.equal(r['batched=1'].connect_to_greeting_pcm_ms.p95, 520);
    assert.equal(r['batched=1'].target_600ms_met_p50, true);
  });

  it('flag defaults off', () => {
    const { queryBatchingEnabled } = require('../src/speech/queryBatching');
    assert.equal(queryBatchingEnabled({}), false);
    assert.equal(queryBatchingEnabled({ VOICE_QUERY_BATCHING: 'off' }), false);
    assert.equal(queryBatchingEnabled({ VOICE_QUERY_BATCHING: 'on' }), true);
  });
});


describe('#859 review fixes', () => {
  const WITH_RPC = () => ({ ...RPCS, merge_call_summary: mergeCallSummaryRpc });
  const summaryWrites = () =>
    fake.log.filter((e) => e.table === 'calls' && e.op === 'update' && (e.payloadKeys || []).includes('summary')).length;
  const rpcCalls = () => fake.count((e) => e.rpc === 'merge_call_summary');

  for (const on of [false, true]) {
    it(`listPendingRecordingCopies matches both JSON spacings (flag ${on ? 'on' : 'off'})`, async () => {
      setFlag(on);
      loadFresh();
      const t = '2026-10-21T10:00:00Z';
      fake.tables.calls.push(
        { id: 'p1', sautikit_call_sid: 'P1', created_at: t, summary: '{"recording_status":"pending_copy","provider":"sautikit"}' },
        { id: 'p2', sautikit_call_sid: 'P2', created_at: t, summary: '{"provider": "sautikit", "recording_status": "pending_copy"}' },
        { id: 'p3', sautikit_call_sid: 'P3', created_at: t, summary: '{"recording_status": "copy_failed", "recording_copy_last_error": "was pending_copy"}' },
        { id: 'p4', sautikit_call_sid: 'P4', created_at: t, summary: '{"recording_status":"copied"}' }
      );
      const rows = await db.listPendingRecordingCopies({ limit: 10 });
      assert.deepEqual(rows.map((r) => r.sautikit_call_sid).sort(), ['P1', 'P2']);
    });
  }

  it('a pending_copy mark written by the RPC (jsonb spacing) is found by the sweep', async () => {
    setFlag(true);
    loadFresh({ rpcs: WITH_RPC() });
    await webhookRow('CA-pend');
    await db.mergeCallSummaryMeta({ callSid: 'CA-pend', patch: { recording_status: 'pending_copy' } });
    assert.match(fake.tables.calls[0].summary, /"recording_status": "pending_copy"/);
    const rows = await db.listPendingRecordingCopies();
    assert.deepEqual(rows.map((r) => r.sautikit_call_sid), ['CA-pend']);
  });

  it('simple key merges go through the RPC (no summary rewrite) and keep RPC-merged keys', async () => {
    setFlag(true);
    loadFresh({ rpcs: WITH_RPC() });
    await webhookRow('CA-k');
    await db.mergeCallSummaryMeta({ callSid: 'CA-k', patch: { brain_key: 'keep me' } });
    fake.reset();
    assert.equal(await db.markWhatsappSent('CA-k', { whatsapp_delivered: true, owner_notify_channels: { sms: 'sent' } }), true);
    assert.equal(await db.markWhatsappSent('CA-k'), false, 'already-sent guard still holds');
    const esc = await db.saveEscalation({ callSid: 'CA-k', teammate: { name: 'Njeri', role: 'owner' }, reason: 'angry caller' });
    assert.equal(esc.escalated_to.name, 'Njeri');
    assert.equal(await db.markEscalationSent('CA-k'), true);
    assert.equal(await db.markEscalationSent('CA-k'), false);
    const rec = await db.attachRecording({ callSid: 'CA-k', recordingUrl: 'https://rec/1.mp3', recordingSid: 'RS1', copy: false });
    assert.equal(rec.recording_url, 'https://rec/1.mp3');
    assert.equal(rec.status, 'complete');
    assert.equal(summaryWrites(), 0, 'no read-then-write of calls.summary');
    assert.equal(rpcCalls(), 4);
    const meta = JSON.parse(fake.tables.calls[0].summary);
    assert.equal(meta.brain_key, 'keep me');
    assert.equal(meta.owner_notified, true);
    assert.equal(meta.whatsapp_sent, true);
    assert.deepEqual(meta.owner_notify_channels, { sms: 'sent' });
    assert.equal(meta.escalate_reason, 'angry caller');
    assert.equal(meta.escalation_sent, true);
    assert.equal(meta.recording_sid, 'RS1');
    await assert.rejects(db.saveEscalation({ callSid: 'CA-gone', reason: 'x' }), /saveEscalation: no call for CA-gone/);
    await assert.rejects(db.attachRecording({ callSid: 'CA-gone', recordingUrl: 'u', copy: false }), /attachRecording: no call for CA-gone/);
    await assert.rejects(db.attachRecording({ callSid: 'CA-gone', recordingUrl: 'u', recordingSid: 'R', copy: false }), /attachRecording: no call for CA-gone/);
  });

  it('flag off: the same calls still read-then-write and give the same summary', async () => {
    const run = async () => {
      await webhookRow('CA-k');
      await db.mergeCallSummaryMeta({ callSid: 'CA-k', patch: { brain_key: 'keep me' } });
      await db.markWhatsappSent('CA-k', { whatsapp_delivered: true, owner_notify_channels: { sms: 'sent' } });
      await db.saveEscalation({ callSid: 'CA-k', teammate: { name: 'Njeri', role: 'owner' }, reason: 'angry caller' });
      await db.markEscalationSent('CA-k');
      await db.attachRecording({ callSid: 'CA-k', recordingUrl: 'https://rec/1.mp3', recordingSid: 'RS1', copy: false });
      return JSON.parse(fake.tables.calls[0].summary);
    };
    setFlag(false);
    loadFresh({ rpcs: WITH_RPC() });
    const off = await run();
    assert.equal(rpcCalls(), 0);
    assert.ok(summaryWrites() >= 5);
    setFlag(true);
    loadFresh({ rpcs: WITH_RPC() });
    const on = await run();
    assert.deepEqual(on, off);
  });

  it('createAppointment: summary keys via the RPC, reason kept when already set', async () => {
    setFlag(true);
    loadFresh({ rpcs: WITH_RPC() });
    await webhookRow('CA-ap');
    await db.mergeCallSummaryMeta({ callSid: 'CA-ap', patch: { reason: 'Braids Friday' } });
    fake.reset();
    const appt = await db.createAppointment({ callSid: 'CA-ap', serviceName: 'Braids', name: 'Achieng', whenText: 'Friday 10am' });
    assert.ok(appt && appt.id);
    assert.equal(summaryWrites(), 0);
    const meta = JSON.parse(fake.tables.calls.find((r) => r.sautikit_call_sid === 'CA-ap').summary);
    assert.equal(meta.appointment_id, appt.id);
    assert.equal(meta.appointment_service, 'Braids');
    assert.equal(meta.reason, 'Braids Friday');
    assert.equal(meta.name, 'Achieng');
  });

  it('createServiceRequest: summary keys via the RPC; reason set when empty', async () => {
    setFlag(true);
    loadFresh({ rpcs: WITH_RPC() });
    await webhookRow('CA-sr');
    fake.reset();
    const req = await db.createServiceRequest({ callSid: 'CA-sr', type: 'hold', name: 'Achieng', item: 'Hair oil', quantity: 2, whenText: 'tomorrow' });
    assert.ok(req && req.id);
    assert.equal(summaryWrites(), 0);
    const meta = JSON.parse(fake.tables.calls.find((r) => r.sautikit_call_sid === 'CA-sr').summary);
    assert.equal(meta.service_request_id, req.id);
    assert.equal(meta.service_request_type, 'hold');
    assert.equal(meta.service_request_item, 'Hair oil');
    assert.match(meta.reason, /^hold — Hair oil/);
    assert.equal(meta.name, 'Achieng');
  });

  it('22P05 (\\u0000 in the patch): old path for that call, RPC stays on', async () => {
    setFlag(true);
    loadFresh({ rpcs: WITH_RPC() });
    await webhookRow('CA-nul');
    fake.reset();
    await db.mergeCallSummaryMeta({ callSid: 'CA-nul', patch: { note: 'a\u0000b' } });
    assert.equal(rpcCalls(), 1);
    assert.equal(summaryWrites(), 1, 'fell back to read-then-write');
    await db.mergeCallSummaryMeta({ callSid: 'CA-nul', patch: { ok: 1 } });
    assert.equal(rpcCalls(), 2, 'no 60 s missing window');
    assert.equal(summaryWrites(), 1);
  });

  it('22P02 is a bad patch too: fallback without the missing window', async () => {
    setFlag(true);
    let calls = 0;
    loadFresh({
      rpcs: {
        ...RPCS,
        merge_call_summary: (args, tables) => {
          calls += 1;
          if (calls === 1) {
            const err = new Error('invalid input syntax for type json');
            err.code = '22P02';
            throw err;
          }
          return mergeCallSummaryRpc(args, tables);
        },
      },
    });
    await webhookRow('CA-22p02');
    await db.mergeCallSummaryMeta({ callSid: 'CA-22p02', patch: { a: 1 } });
    await db.mergeCallSummaryMeta({ callSid: 'CA-22p02', patch: { b: 2 } });
    assert.equal(calls, 2);
    const meta = JSON.parse(fake.tables.calls[0].summary);
    assert.equal(meta.a, 1);
    assert.equal(meta.b, 2);
  });

  it('only PGRST202 / 42883 count as missing; permission errors fall back per call', async () => {
    for (const [code, missing] of [['42501', false], ['57014', false], ['PGRST202', true], ['42883', true]]) {
      setFlag(true);
      let calls = 0;
      loadFresh({
        rpcs: {
          ...RPCS,
          merge_call_summary: () => {
            calls += 1;
            const err = new Error(`rpc failed ${code}`);
            err.code = code;
            throw err;
          },
        },
      });
      await webhookRow(`CA-${code}`);
      await db.mergeCallSummaryMeta({ callSid: `CA-${code}`, patch: { a: 1 } });
      await db.mergeCallSummaryMeta({ callSid: `CA-${code}`, patch: { b: 2 } });
      const meta = JSON.parse(fake.tables.calls[0].summary);
      assert.equal(meta.a, 1, code);
      assert.equal(meta.b, 2, code);
      assert.equal(calls, missing ? 1 : 2, `${code}: missing window ${missing}`);
    }
  });

  it('appendTranscript: call row gone mid-call (23503) warns and returns null; memo forgotten', async () => {
    setFlag(true);
    loadFresh({
      rpcs: WITH_RPC(),
      hooks: {
        insert: (table, payload, tables) => {
          if (table !== 'transcripts') return null;
          const ids = new Set((tables.calls || []).map((r) => r.id));
          const bad = (Array.isArray(payload) ? payload : [payload]).some((r) => !ids.has(r.call_id));
          return bad
            ? { code: '23503', message: 'insert or update on table "transcripts" violates foreign key constraint "transcripts_call_id_fkey"' }
            : null;
        },
      },
    });
    await webhookRow('CA-fk');
    fake.tables.calls = []; // row deleted mid-call (memo still has its id)
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    let out;
    try {
      out = await db.appendTranscript({ callSid: 'CA-fk', turns: [{ speaker: 'caller', text: 'Hi' }] });
    } finally {
      console.warn = realWarn;
    }
    assert.equal(out, null);
    assert.ok(warnings.some((w) => /appendTranscript: no call row for CA-fk/.test(w)));
    fake.reset();
    assert.equal(await db.getCallIdentity('CA-fk'), null);
    assert.equal(fake.count((e) => e.table === 'calls' && e.op === 'select'), 1, 'memo dropped: fresh getCall');
  });

  it('other transcript insert errors still throw', async () => {
    setFlag(true);
    loadFresh({ hooks: { insert: (table) => (table === 'transcripts' ? { code: '42501', message: 'permission denied' } : null) } });
    await webhookRow('CA-perm');
    await assert.rejects(db.appendTranscript({ callSid: 'CA-perm', turns: [{ speaker: 'agent', text: 'x' }] }), /permission denied/);
  });

  it('forgetCallIdentity drops the memo; server.js calls it on media close and relay cleanup', async () => {
    setFlag(true);
    loadFresh();
    await webhookRow('CA-forget');
    fake.reset();
    await db.getCallIdentity('CA-forget');
    assert.equal(fake.count(), 0, 'memo hit');
    db.forgetCallIdentity('CA-forget');
    await db.getCallIdentity('CA-forget');
    assert.equal(fake.count(), 1, 'fresh getCall after forget');
    const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(server, /callTenantProfiles\.delete\(sessionCallSid\);\n.*\n\s+db\.forgetCallIdentity\?\.\(sessionCallSid\);/);
    assert.match(server, /callTenantProfiles\.delete\(callSid\);\n\s+db\.forgetCallIdentity\?\.\(callSid\);/);
  });
});
